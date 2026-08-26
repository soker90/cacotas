import { createMovement } from '../shared/factory.ts'
import { madridNow, runNotifications } from './notify.ts'
import type { MovementType } from '../shared/types.ts'

/**
 * Cacotas sync worker (SPEC.md §9). Append-only ledger on D1 (D-02):
 * rows are only INSERTed; `seq` is assigned by SQLite and doubles as the
 * sync cursor. Idempotency by client UUID (D-17).
 */

export interface Env {
  DB: D1Database
  AUTH_SECRET: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  HEARTBEAT_URL?: string
}

interface MovementRow {
  seq: number
  id: string
  baby_id: string
  size_id: number
  type: string
  usage_source: string | null
  quantity: number
  delta: number
  undoes_movement_id: string | null
  note: string | null
  occurred_at: number
  recorded_at: number
  device_id: string
}

interface WeightRow {
  seq: number
  id: string
  baby_id: string
  weight_kg: number
  recorded_at: number
  device_id: string
}

interface BabyRow {
  id: string
  name: string
  birth_date: string | null
  zone_id: string
  created_at: number
  updated_at: number
}

const PAGE_SIZE = 500
const DEBOUNCE_MS = 60_000

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const authorized = (request: Request, env: Env): boolean =>
  request.headers.get('X-Auth') === env.AUTH_SECRET && env.AUTH_SECRET !== ''

/** Wire-shape validation of §4.3 that does not need the UNDO original:
 *  an UNDO may legitimately arrive before the movement it undoes. */
interface WireMovement {
  id: string
  babyId: string
  sizeId: number
  type: MovementType
  usageSource?: 'OWN_STOCK' | 'EXTERNAL'
  quantity: number
  delta: number
  undoesMovementId?: string
  note?: string
  occurredAt: number
  recordedAt: number
  deviceId: string
}

const isValidWireMovement = (m: unknown): m is WireMovement => {
  if (typeof m !== 'object' || m === null) return false
  const r = m as Record<string, unknown>
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  const int = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v)

  if (!str(r.id) || !str(r.babyId) || !str(r.deviceId)) return false
  if (!int(r.sizeId) || r.sizeId < 0 || r.sizeId > 6) return false
  if (!int(r.quantity) || r.quantity < 0) return false
  if (!int(r.delta)) return false
  if (!int(r.occurredAt) || !int(r.recordedAt)) return false
  if ((r.occurredAt) > (r.recordedAt) + 60_000) { return false }

  switch (r.type) {
    case 'USAGE':
      return (
        (r.usageSource === 'OWN_STOCK' || r.usageSource === 'EXTERNAL') &&
        r.quantity >= 1 &&
        r.delta === (r.usageSource === 'OWN_STOCK' ? -r.quantity : 0)
      )
    case 'PURCHASE':
      return r.quantity >= 1 && r.delta === r.quantity
    case 'INITIAL':
      return r.delta === r.quantity
    case 'ADJUSTMENT':
      return (
        r.delta !== 0 &&
        r.quantity === Math.abs(r.delta)
      )
    case 'UNDO':
      return str(r.undoesMovementId)
    case 'SIZE_CHANGE':
      return r.quantity === 0 && r.delta === 0
    default:
      return false
  }
}

const rowToMovement = (row: MovementRow) => ({
  id: row.id,
  babyId: row.baby_id,
  sizeId: row.size_id,
  type: row.type,
  ...(row.usage_source !== null ? { usageSource: row.usage_source } : {}),
  quantity: row.quantity,
  delta: row.delta,
  ...(row.undoes_movement_id !== null
    ? { undoesMovementId: row.undoes_movement_id }
    : {}),
  ...(row.note !== null ? { note: row.note } : {}),
  occurredAt: row.occurred_at,
  recordedAt: row.recorded_at,
  deviceId: row.device_id,
  serverSeq: row.seq,
})

const rowToWeight = (row: WeightRow) => ({
  id: row.id,
  babyId: row.baby_id,
  weightKg: row.weight_kg,
  recordedAt: row.recorded_at,
  deviceId: row.device_id,
  serverSeq: row.seq,
})

const rowToBaby = (row: BabyRow) => ({
  id: row.id,
  name: row.name,
  ...(row.birth_date !== null ? { birthDate: row.birth_date } : {}),
  zoneId: row.zone_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const handleSync = async (
  request: Request,
  env: Env
): Promise<Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) { return json({ error: 'invalid payload' }, 400) }

  const req = body as Record<string, unknown>
  if (typeof req.deviceId !== 'string' || req.deviceId === '') { return json({ error: 'deviceId required' }, 400) }
  if (typeof req.since !== 'number' || !Number.isInteger(req.since) || req.since < 0) { return json({ error: 'since must be a non-negative integer' }, 400) }

  const incomingMovements = Array.isArray(req.movements) ? req.movements : []
  const incomingWeights = Array.isArray(req.weights) ? req.weights : []

  // ── Upload ────────────────────────────────────────────
  const validMovements: WireMovement[] = []
  for (const m of incomingMovements) {
    // Server-side revalidation with the shared rules; malformed payloads
    // are rejected whole rather than partially applied.
    if (!isValidWireMovement(m)) return json({ error: 'invalid movement' }, 400)
    validMovements.push(m)
  }

  const accepted: string[] = []
  if (validMovements.length > 0) {
    const statements = validMovements.map((m) =>
      env.DB.prepare(
        `INSERT INTO movements
           (id, baby_id, size_id, type, usage_source, quantity, delta,
            undoes_movement_id, note, occurred_at, recorded_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO NOTHING`
      )
        .bind(
          m.id,
          m.babyId,
          m.sizeId,
          m.type,
          m.usageSource ?? null,
          m.quantity,
          m.delta,
          m.undoesMovementId ?? null,
          m.note ?? null,
          m.occurredAt,
          m.recordedAt,
          m.deviceId
        )
    )
    await env.DB.batch(statements)
  }
  for (const m of validMovements) accepted.push(m.id)

  for (const w of incomingWeights) {
    if (
      typeof w !== 'object' ||
      w === null ||
      typeof (w as Record<string, unknown>).id !== 'string'
    ) {
      return json({ error: 'invalid weight' }, 400)
    }
  }
  if (incomingWeights.length > 0) {
    const statements = incomingWeights.map((w) => {
      const r = w as Record<string, unknown>
      return env.DB.prepare(
        `INSERT INTO weights (id, baby_id, weight_kg, recorded_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO NOTHING`
      ).bind(r.id, r.babyId, r.weightKg, r.recordedAt, r.deviceId)
    })
    await env.DB.batch(statements)
  }

  // ── Baby: last-write-wins over updated_at (§9.2) ──────
  let requestBaby: Record<string, unknown> | undefined
  if (
    typeof req.baby === 'object' &&
    req.baby !== null &&
    typeof (req.baby as Record<string, unknown>).id === 'string'
  ) {
    requestBaby = req.baby as Record<string, unknown>
    const b = requestBaby
    if (
      typeof b.name !== 'string' ||
      typeof b.zoneId !== 'string' ||
      typeof b.createdAt !== 'number' ||
      typeof b.updatedAt !== 'number'
    ) {
      return json({ error: 'invalid baby' }, 400)
    }
    await env.DB.prepare(
      `INSERT INTO babies (id, name, birth_date, zone_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         birth_date = excluded.birth_date,
         zone_id = excluded.zone_id,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at > babies.updated_at`
    )
      .bind(
        b.id,
        b.name,
        typeof b.birthDate === 'string' ? b.birthDate : null,
        b.zoneId,
        b.createdAt,
        b.updatedAt
      )
      .run()
  }

  // ── Download: everything past the caller's cursor ─────
  const since = req.since
  const movementRows = await env.DB.prepare(
    `SELECT * FROM movements WHERE seq > ? ORDER BY seq LIMIT ${PAGE_SIZE}`
  )
    .bind(since)
    .all<MovementRow>()
  const weightRows = await env.DB.prepare(
    `SELECT * FROM weights WHERE seq > ? ORDER BY seq LIMIT ${PAGE_SIZE}`
  )
    .bind(since)
    .all<WeightRow>()

  const hasMore =
    (movementRows.results?.length ?? 0) === PAGE_SIZE ||
    (weightRows.results?.length ?? 0) === PAGE_SIZE

  const serverSeqs = (movementRows.results ?? []).map((row) => row.seq)
  const cursor =
    serverSeqs.length > 0 ? Math.max(...serverSeqs) : since

  const babyRows = await env.DB.prepare(
    'SELECT * FROM babies LIMIT 1'
  ).all<BabyRow>()
  const baby =
    babyRows.results && babyRows.results.length > 0
      ? rowToBaby(babyRows.results[0])
      : undefined

  return json({
    cursor,
    hasMore,
    movements: (movementRows.results ?? []).map(rowToMovement),
    weights: (weightRows.results ?? []).map(rowToWeight),
    ...(baby !== undefined ? { baby } : {}),
    accepted,
  })
}

const handleSingleMovement = async (
  request: Request,
  env: Env
): Promise<Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) { return json({ error: 'invalid payload' }, 400) }

  const r = body as Record<string, unknown>
  if (r.type !== 'USAGE') { return json({ error: 'only USAGE supported' }, 400) }
  if (r.usageSource !== 'OWN_STOCK' && r.usageSource !== 'EXTERNAL') { return json({ error: 'usageSource required' }, 400) }
  if (typeof r.deviceId !== 'string' || r.deviceId === '') { return json({ error: 'deviceId required' }, 400) }

  const now = Date.now()

  // Debounce 60 s per deviceId (§9.4): measured from the last recorded
  // usage of that device — ignored requests do not extend the window.
  const last = await env.DB.prepare(
    `SELECT recorded_at FROM movements
     WHERE device_id = ?1 AND type = 'USAGE'
     ORDER BY seq DESC LIMIT 1`
  )
    .bind(r.deviceId)
    .first<{ recorded_at: number }>()
  if (last && now - last.recorded_at < DEBOUNCE_MS) {
    return json({ status: 'debounced' }, 200)
  }

  const sizeRow = await env.DB.prepare(
    `SELECT size_id FROM movements WHERE type = 'SIZE_CHANGE'
     ORDER BY occurred_at DESC LIMIT 1`
  ).first<{ size_id: number }>()
  if (!sizeRow) return json({ error: 'no size configured yet' }, 400)

  const babyRow = await env.DB.prepare('SELECT id FROM babies LIMIT 1').first<{
    id: string
  }>()
  if (!babyRow) return json({ error: 'no baby configured yet' }, 400)

  const movement = createMovement(
    {
      id: crypto.randomUUID(),
      babyId: babyRow.id,
      sizeId: sizeRow.size_id,
      deviceId: r.deviceId,
      occurredAt: now,
      recordedAt: now,
    },
    { type: 'USAGE', usageSource: r.usageSource, quantity: 1 }
  )

  await env.DB.prepare(
    `INSERT INTO movements
       (id, baby_id, size_id, type, usage_source, quantity, delta,
        occurred_at, recorded_at, device_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  )
    .bind(
      movement.id,
      movement.babyId,
      movement.sizeId,
      movement.type,
      movement.usageSource ?? null,
      movement.quantity,
      movement.delta,
      movement.occurredAt,
      movement.recordedAt,
      movement.deviceId
    )
    .run()

  return json({ movement: { ...movement, serverSeq: 0 } }, 200)
}

const handlePushSubscribe = async (
  request: Request,
  env: Env
): Promise<Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) { return json({ error: 'invalid payload' }, 400) }
  const r = body as Record<string, unknown>
  const keys = r.keys as Record<string, unknown> | undefined
  if (
    typeof r.deviceId !== 'string' ||
    typeof r.endpoint !== 'string' ||
    typeof keys?.p256dh !== 'string' ||
    typeof keys?.auth !== 'string'
  ) {
    return json({ error: 'deviceId, endpoint and keys required' }, 400)
  }

  await env.DB.prepare(
    `INSERT INTO push_subscriptions (device_id, endpoint, keys_json)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(device_id) DO UPDATE SET
       endpoint = excluded.endpoint,
       keys_json = excluded.keys_json`
  )
    .bind(r.deviceId, r.endpoint, JSON.stringify(keys))
    .run()
  return json({ status: 'subscribed' })
}

const handleSnooze = async (
  request: Request,
  env: Env
): Promise<Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) { return json({ error: 'invalid payload' }, 400) }
  const r = body as Record<string, unknown>
  if (
    typeof r.babyId !== 'string' ||
    typeof r.kind !== 'string' ||
    !Number.isInteger(r.sizeId) ||
    !Number.isInteger(r.snoozedUntil)
  ) {
    return json({ error: 'babyId, kind, sizeId, snoozedUntil required' }, 400)
  }

  await env.DB.prepare(
    `UPDATE notification_log SET snoozed_until = ?4
     WHERE baby_id = ?1 AND size_id = ?2 AND kind = ?3`
  )
    .bind(r.babyId, r.sizeId, r.kind, r.snoozedUntil)
    .run()
  return json({ status: 'snoozed' })
}

export default {
  // Hourly cron; the notification pass only runs during the 20:00 hour in
  // Europe/Madrid (cron triggers are UTC-only).
  async scheduled (
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const { hour } = madridNow()
    if (hour !== 20) return

    const result = await runNotifications(env)

    // healthchecks.io heartbeat — silence here means "out of diapers soon"
    if (env.HEARTBEAT_URL !== undefined && env.HEARTBEAT_URL !== '') {
      ctx.waitUntil(fetch(env.HEARTBEAT_URL).catch(() => undefined))
    }
    console.log('notifications:', JSON.stringify(result))
  },

  fetch (request: Request, env: Env): Promise<Response> {
    return (async () => {
      const url = new URL(request.url)
      if (request.method !== 'POST') return json({ error: 'not found' }, 404)

      // /snooze is called from the service worker on notificationclick,
      // which has no access to the build-time secret. Low-risk action
      // (silences one notification kind) — accepted per §9.8's model.
      if (url.pathname !== '/snooze' && !authorized(request, env)) {
        return json({ error: 'unauthorized' }, 401)
      }

      switch (url.pathname) {
        case '/sync':
          return handleSync(request, env)
        case '/movement':
          return handleSingleMovement(request, env)
        case '/push-subscribe':
          return handlePushSubscribe(request, env)
        case '/snooze':
          return handleSnooze(request, env)
        case '/run-notifications':
          return runNotifications(env).then((result) => json(result))
        default:
          return json({ error: 'not found' }, 404)
      }
    })()
  },
}
