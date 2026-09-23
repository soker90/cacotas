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
  GOOGLE_CLIENT_ID: string
  VAPID_PRIVATE_KEY: string
  VAPID_PUBLIC_KEY: string
  VAPID_SUBJECT: string
  APP_URL: string
  HEARTBEAT_URL?: string
}

interface MovementRow {
  seq: number
  baby_seq: number
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
  location_id: string | null
}

interface LocationRow {
  id: string
  name: string
  reorder_point: number
  created_at: number
  updated_at: number
  device_id: string
}

interface WeightRow {
  seq: number
  baby_seq: number
  id: string
  baby_id: string
  weight_kg: number
  length_cm: number | null
  recorded_at: number
  device_id: string
}

interface BabyRow {
  id: string
  name: string
  birth_date: string | null
  zone_id: string
  birth_weight_kg: number | null
  sex: string | null
  gestational_weeks: number | null
  created_at: number
  updated_at: number
}

const PAGE_SIZE = 500
const DEBOUNCE_MS = 60_000

/** Location used by the physical button when it does not send one explicitly. */
export const resolveMovementLocationId = (babyId: string, locationId?: string): string =>
  locationId ?? `default:${babyId}`

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

interface UserRow {
  id: string
  household_id: string | null
  email: string | null
  display_name: string | null
}

interface AuthenticatedRequest {
  user: UserRow
  tokenHash: string
}

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const randomToken = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const authenticate = async (request: Request, env: Env): Promise<AuthenticatedRequest | Response> => {
  const header = request.headers.get('Authorization')
  if (header === null || !header.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)
  const tokenHash = await sha256(header.slice(7))
  const row = await env.DB.prepare(
    `SELECT u.id, u.household_id, u.email, u.display_name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.revoked_at IS NULL AND s.last_seen > ?2`
  ).bind(tokenHash, Date.now() - 90 * 24 * 60 * 60 * 1000).first<UserRow>()
  if (row === null) return json({ error: 'unauthorized' }, 401)
  await env.DB.prepare('UPDATE sessions SET last_seen = ?2 WHERE token_hash = ?1').bind(tokenHash, Date.now()).run()
  return { user: row, tokenHash }
}

interface GoogleToken {
  iss: string
  aud: string
  sub: string
  exp: number
  email?: string
  email_verified?: string | boolean
  name?: string
}

const decodeBase64Url = (value: string): ArrayBuffer => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)).buffer
}

const verifyGoogleIdToken = async (token: string, clientId: string): Promise<GoogleToken | null> => {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let header: { alg?: string; kid?: string }
  let payload: GoogleToken
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(decodeBase64Url(parts[0])))) as { alg?: string; kid?: string }
    payload = JSON.parse(new TextDecoder().decode(new Uint8Array(decodeBase64Url(parts[1])))) as GoogleToken
  } catch {
    return null
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || payload.aud !== clientId ||
      (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') ||
      !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000) || payload.sub === '') return null
  try {
    const keysResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs')
    if (!keysResponse.ok) return null
    const keys = JSON.parse(await keysResponse.text()) as { keys?: Array<JsonWebKey & { kid?: string }> }
    const key = keys.keys?.find((candidate) => candidate.kid === header.kid)
    if (!key) return null
    const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, decodeBase64Url(parts[2]), signingInput) ? payload : null
  } catch {
    return null
  }
}

const handleGoogleAuth = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (env.GOOGLE_CLIENT_ID === '') {
    return json({ error: 'google auth not configured' }, 503)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'invalid payload' }, 400)
  }

  const r = body as Record<string, unknown>
  if (typeof r.idToken !== 'string' || r.idToken === '') {
    return json({ error: 'idToken required' }, 400)
  }

  const google = await verifyGoogleIdToken(r.idToken, env.GOOGLE_CLIENT_ID)
  if (google === null) {
    return json({ error: 'invalid google token' }, 401)
  }
  if (google.email_verified !== true && google.email_verified !== 'true') {
    return json({ error: 'invalid google token' }, 401)
  }

  const existing = await env.DB.prepare(
    'SELECT id, household_id, email, display_name FROM users WHERE provider = ?1 AND provider_sub = ?2',
  )
    .bind('google', google.sub)
    .first<UserRow>()

  const user = existing ?? {
    id: crypto.randomUUID(),
    household_id: null,
    email: typeof google.email === 'string' ? normalizeEmail(google.email) : null,
    display_name: typeof google.name === 'string' ? google.name : null,
  }

  if (existing === null) {
    await env.DB.prepare(
      'INSERT INTO users (id, household_id, provider, provider_sub, email, display_name, created_at) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6)',
    )
      .bind(
        user.id,
        'google',
        google.sub,
        user.email,
        user.display_name,
        Date.now(),
      )
      .run()
  }

  const rawToken = randomToken()
  const deviceId =
    typeof r.deviceId === 'string' && r.deviceId !== '' ? r.deviceId : 'web'
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM sessions WHERE user_id=?1 AND device_id=?2',
    ).bind(user.id, deviceId),
    env.DB.prepare(
      'INSERT INTO sessions (token_hash,user_id,device_id,created_at,last_seen) VALUES (?1,?2,?3,?4,?4)',
    ).bind(await sha256(rawToken), user.id, deviceId, Date.now()),
  ])

  return json({ token: rawToken, user })
}

const requireHousehold = (auth: AuthenticatedRequest): string | Response =>
  auth.user.household_id ?? json({ error: 'household required' }, 409)

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
  locationId?: string
}

const isValidWireMovement = (m: unknown): m is WireMovement => {
  if (typeof m !== 'object' || m === null) return false
  const r = m as Record<string, unknown>
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  const int = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v)

  if (!str(r.id) || !str(r.babyId) || !str(r.deviceId)) return false
  if (r.locationId !== undefined && !str(r.locationId)) return false
  if (!int(r.sizeId) || r.sizeId < 0 || r.sizeId > 7) return false
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
    case 'SIGNAL':
      return (
        r.quantity === 0 &&
        r.delta === 0 &&
        typeof r.note === 'string' &&
        ['tabsNotCentered', 'noTwoFingers', 'redMarks', 'uncoveredButtocks', 'frequentDermatitis', 'pullsDiaper'].includes(r.note)
      )
    case 'SNOOZE':
      return r.quantity === 0 && r.delta === 0 && r.note === undefined
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
  ...(row.location_id !== null ? { locationId: row.location_id } : {}),
  serverSeq: row.baby_seq,
})

const rowToWeight = (row: WeightRow) => ({
  id: row.id,
  babyId: row.baby_id,
  weightKg: row.weight_kg,
  ...(row.length_cm !== null ? { lengthCm: row.length_cm } : {}),
  recordedAt: row.recorded_at,
  deviceId: row.device_id,
  serverSeq: row.baby_seq,
})

const rowToBaby = (row: BabyRow) => ({
  id: row.id,
  name: row.name,
  ...(row.birth_date !== null ? { birthDate: row.birth_date } : {}),
  zoneId: row.zone_id,
  ...(row.birth_weight_kg !== null
    ? { birthWeightKg: row.birth_weight_kg }
    : {}),
  ...(row.sex !== null ? { sex: row.sex } : {}),
  ...(row.gestational_weeks !== null
    ? { gestationalWeeks: row.gestational_weeks }
    : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const handleSync = async (request: Request, env: Env): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const householdId = requireHousehold(auth)
  if (householdId instanceof Response) return householdId
  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  if (typeof body !== 'object' || body === null) return json({ error: 'invalid payload' }, 400)
  const req = body as Record<string, unknown>
  if (typeof req.deviceId !== 'string' || req.deviceId === '') return json({ error: 'deviceId required' }, 400)
  const rawCursors = req.cursors
  if (typeof rawCursors !== 'object' || rawCursors === null) return json({ error: 'cursors required' }, 400)
  const cursors: Record<string, number> = {}
  for (const [babyId, value] of Object.entries(rawCursors)) {
    if (!Number.isInteger(value) || (value as number) < 0) return json({ error: 'invalid cursor' }, 400)
    cursors[babyId] = value as number
  }

  const incomingLocations = Array.isArray(req.locations) ? req.locations : []
  for (const location of incomingLocations) {
    if (typeof location !== 'object' || location === null) return json({ error: 'invalid location' }, 400)
    const r = location as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || r.name.trim() === '' ||
        typeof r.reorderPoint !== 'number' || !Number.isInteger(r.reorderPoint) ||
        typeof r.createdAt !== 'number' || typeof r.updatedAt !== 'number' || typeof r.deviceId !== 'string') {
      return json({ error: 'invalid location' }, 400)
    }
    const owned = await env.DB.prepare('SELECT id FROM locations WHERE id = ?1 AND household_id = ?2').bind(r.id, householdId).first()
    if (owned === null) {
      await env.DB.prepare(
        'INSERT INTO locations (id, household_id, name, reorder_point, created_at, updated_at, device_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name, reorder_point=excluded.reorder_point, updated_at=excluded.updated_at, device_id=excluded.device_id WHERE locations.household_id=excluded.household_id AND excluded.updated_at > locations.updated_at'
      ).bind(r.id, householdId, r.name.trim(), r.reorderPoint, r.createdAt, r.updatedAt, r.deviceId).run()
    } else {
      await env.DB.prepare('UPDATE locations SET name=?2, reorder_point=?3, updated_at=?4, device_id=?5 WHERE id=?1 AND household_id=?6 AND updated_at < ?4').bind(r.id, r.name.trim(), r.reorderPoint, r.updatedAt, r.deviceId, householdId).run()
    }
  }

  const incomingMovements = Array.isArray(req.movements) ? req.movements : []
  const accepted: string[] = []
  for (const m of incomingMovements) {
    if (!isValidWireMovement(m)) return json({ error: 'invalid movement' }, 400)
    const owned = await env.DB.prepare('SELECT id FROM babies WHERE id=?1 AND household_id=?2').bind(m.babyId, householdId).first()
    if (owned === null) return json({ error: 'forbidden baby' }, 403)
    const existing = await env.DB.prepare('SELECT id, household_id FROM movements WHERE id=?1').bind(m.id).first<{ id: string; household_id: string }>()
    if (existing !== null && existing.household_id !== householdId) return json({ error: 'forbidden movement' }, 403)
    if (existing === null) {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO baby_sequences (baby_id, next_seq) VALUES (?1, 2) ON CONFLICT(baby_id) DO UPDATE SET next_seq = next_seq + 1',
        ).bind(m.babyId),
        env.DB.prepare(
          `INSERT INTO movements (id, household_id, baby_id, baby_seq, size_id, type, usage_source, quantity, delta, undoes_movement_id, note, occurred_at, recorded_at, device_id, location_id)
           VALUES (?1, ?2, ?3, (SELECT next_seq - 1 FROM baby_sequences WHERE baby_id=?3), ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
        ).bind(
          m.id,
          householdId,
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
          m.deviceId,
          m.locationId ?? null,
        ),
      ])
    }
    accepted.push(m.id)
  }

  const incomingWeights = Array.isArray(req.weights) ? req.weights : []
  for (const w of incomingWeights) {
    if (typeof w !== 'object' || w === null) return json({ error: 'invalid weight' }, 400)
    const r = w as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.babyId !== 'string' || typeof r.weightKg !== 'number' || typeof r.recordedAt !== 'number' || typeof r.deviceId !== 'string') return json({ error: 'invalid weight' }, 400)
    const owned = await env.DB.prepare('SELECT id FROM babies WHERE id=?1 AND household_id=?2').bind(r.babyId, householdId).first()
    if (owned === null) return json({ error: 'forbidden baby' }, 403)
    const existing = await env.DB.prepare('SELECT id, household_id FROM weights WHERE id=?1').bind(r.id).first<{ id: string; household_id: string }>()
    if (existing !== null && existing.household_id !== householdId) return json({ error: 'forbidden weight' }, 403)
    if (existing === null) {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO baby_sequences (baby_id, next_seq) VALUES (?1, 2) ON CONFLICT(baby_id) DO UPDATE SET next_seq = next_seq + 1',
        ).bind(r.babyId),
        env.DB.prepare(
          `INSERT INTO weights (id, household_id, baby_id, baby_seq, weight_kg, length_cm, recorded_at, device_id)
           VALUES (?1, ?2, ?3, (SELECT next_seq - 1 FROM baby_sequences WHERE baby_id=?3), ?4, ?5, ?6, ?7)`,
        ).bind(
          r.id,
          householdId,
          r.babyId,
          r.weightKg,
          typeof r.lengthCm === 'number' ? r.lengthCm : null,
          r.recordedAt,
          r.deviceId,
        ),
      ])
    }
    accepted.push(r.id)
  }

  if (typeof req.baby === 'object' && req.baby !== null) {
    const b = req.baby as Record<string, unknown>
    if (typeof b.id !== 'string' || typeof b.name !== 'string' || typeof b.zoneId !== 'string' || typeof b.createdAt !== 'number' || typeof b.updatedAt !== 'number') return json({ error: 'invalid baby' }, 400)
    const existing = await env.DB.prepare('SELECT id, household_id FROM babies WHERE id=?1').bind(b.id).first<{ id: string; household_id: string }>()
    if (existing !== null && existing.household_id !== householdId) return json({ error: 'forbidden baby' }, 403)
    if (existing === null) {
      await env.DB.prepare('INSERT INTO babies (id, household_id, name, birth_date, zone_id, birth_weight_kg, sex, gestational_weeks, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)').bind(b.id, householdId, b.name, typeof b.birthDate === 'string' ? b.birthDate : null, b.zoneId, typeof b.birthWeightKg === 'number' ? b.birthWeightKg : null, typeof b.sex === 'string' ? b.sex : null, typeof b.gestationalWeeks === 'number' ? b.gestationalWeeks : null, b.createdAt, b.updatedAt).run()
    } else {
      await env.DB.prepare('UPDATE babies SET name=?3,birth_date=?4,zone_id=?5,birth_weight_kg=?6,sex=?7,gestational_weeks=?8,updated_at=?9 WHERE id=?1 AND household_id=?2 AND updated_at < ?9').bind(b.id, householdId, b.name, typeof b.birthDate === 'string' ? b.birthDate : null, b.zoneId, typeof b.birthWeightKg === 'number' ? b.birthWeightKg : null, typeof b.sex === 'string' ? b.sex : null, typeof b.gestationalWeeks === 'number' ? b.gestationalWeeks : null, b.updatedAt).run()
    }
  }

  const babyRows = await env.DB.prepare('SELECT * FROM babies WHERE household_id=?1 ORDER BY created_at,id').bind(householdId).all<BabyRow>()
  const babies = (babyRows.results ?? []).map(rowToBaby)
  const movements: ReturnType<typeof rowToMovement>[] = []
  const weights: ReturnType<typeof rowToWeight>[] = []
  const hasMore: Record<string, boolean> = {}
  const nextCursors: Record<string, number> = { ...cursors }
  for (const b of babies) {
    const cursor = cursors[b.id] ?? 0
    const rows = await env.DB.prepare(
      `SELECT * FROM (
         SELECT baby_seq, 'movement' AS row_kind, seq, id, household_id, baby_id, size_id, type, usage_source, quantity, delta, undoes_movement_id, note, occurred_at, recorded_at, device_id, location_id, NULL AS weight_kg, NULL AS length_cm
         FROM movements WHERE household_id=?1 AND baby_id=?2 AND baby_seq>?3
         UNION ALL
         SELECT baby_seq, 'weight' AS row_kind, seq, id, household_id, baby_id, NULL AS size_id, NULL AS type, NULL AS usage_source, NULL AS quantity, NULL AS delta, NULL AS undoes_movement_id, NULL AS note, NULL AS occurred_at, recorded_at, device_id, NULL AS location_id, weight_kg, length_cm
         FROM weights WHERE household_id=?1 AND baby_id=?2 AND baby_seq>?3
       ) ORDER BY baby_seq LIMIT ?4`,
    ).bind(householdId, b.id, cursor, PAGE_SIZE).all<Record<string, unknown>>()
    const page = rows.results ?? []
    for (const row of page) {
      if (row.row_kind === 'movement') {
        movements.push(rowToMovement(row as unknown as MovementRow))
      } else {
        weights.push(rowToWeight(row as unknown as WeightRow))
      }
    }
    const maxSeq = Math.max(cursor, ...page.map((row) => Number(row.baby_seq)))
    nextCursors[b.id] = maxSeq
    const more = page.length === PAGE_SIZE
    hasMore[b.id] = more
  }
  const locationRows = await env.DB.prepare('SELECT * FROM locations WHERE household_id=?1 ORDER BY created_at,id').bind(householdId).all<LocationRow>()
  return json({ babies, cursors: nextCursors, hasMore, movements, weights, locations: locationRows.results ?? [], accepted })
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

const inviteCode = (): string => {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(
    bytes,
    (byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 32],
  ).join('')
}

const handleCreateHousehold = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  if (auth.user.household_id !== null) {
    return json({ error: 'already in household' }, 409)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'invalid payload' }, 400)
  }

  const r = body as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (name === '' || name.length > 100) {
    return json({ error: 'invalid household name' }, 400)
  }

  const b = r.baby
  if (typeof b !== 'object' || b === null) {
    return json({ error: 'baby required' }, 400)
  }
  const baby = b as Record<string, unknown>
  if (
    typeof baby.name !== 'string' ||
    baby.name.trim() === '' ||
    typeof baby.zoneId !== 'string'
  ) {
    return json({ error: 'invalid baby' }, 400)
  }

  const householdId = crypto.randomUUID()
  const babyId =
    typeof baby.id === 'string' && baby.id !== ''
      ? baby.id
      : crypto.randomUUID()
  const now = Date.now()

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO households (id,name,created_by,created_at) VALUES (?1,?2,?3,?4)',
    ).bind(householdId, name, auth.user.id, now),
    env.DB.prepare(
      'UPDATE users SET household_id=?1 WHERE id=?2 AND household_id IS NULL',
    ).bind(householdId, auth.user.id),
    env.DB.prepare(
      'INSERT INTO babies (id,household_id,name,birth_date,zone_id,birth_weight_kg,sex,gestational_weeks,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)',
    ).bind(
      babyId,
      householdId,
      baby.name.trim(),
      typeof baby.birthDate === 'string' ? baby.birthDate : null,
      baby.zoneId,
      typeof baby.birthWeightKg === 'number' ? baby.birthWeightKg : null,
      typeof baby.sex === 'string' ? baby.sex : null,
      typeof baby.gestationalWeeks === 'number'
        ? baby.gestationalWeeks
        : null,
      now,
    ),
  ])

  return json({ householdId, babyId })
}

const handleHouseholdStatus = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth

  if (auth.user.household_id === null) {
    const email = normalizeEmail(auth.user.email ?? '')
    const invites =
      email === ''
        ? []
        : (
            await env.DB.prepare(
              'SELECT i.code,i.expires_at,h.id AS household_id,h.name,u.display_name AS inviter_name FROM invites i JOIN households h ON h.id=i.household_id LEFT JOIN users u ON u.id=i.created_by WHERE i.redeemed_at IS NULL AND i.rejected_at IS NULL AND i.expires_at>?2 ORDER BY i.created_at DESC',
            )
              .bind(Date.now())
              .all()
          ).results ?? []

    return json({ user: auth.user, invites })
  }

  const household = await env.DB.prepare(
    'SELECT id,name,created_by,created_at FROM households WHERE id=?1',
  )
    .bind(auth.user.household_id)
    .first()
  const users =
    (
      await env.DB.prepare(
        'SELECT id,email,display_name FROM users WHERE household_id=?1 ORDER BY created_at,id',
      )
        .bind(auth.user.household_id)
        .all()
    ).results ?? []

  return json({ user: auth.user, household, users })
}

const handleInvite = async (request: Request, env: Env): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const householdId = requireHousehold(auth)
  if (householdId instanceof Response) return householdId
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE household_id=?1').bind(householdId).first<{ count: number }>()
  if ((count?.count ?? 0) >= 2) return json({ error: 'household full' }, 409)
  const household = await env.DB.prepare('SELECT name FROM households WHERE id=?1').bind(householdId).first<{ name: string }>()
  const existing = await env.DB.prepare(
    'SELECT code FROM invites WHERE household_id=?1 AND redeemed_at IS NULL AND rejected_at IS NULL AND expires_at>?2 ORDER BY created_at DESC LIMIT 1'
  ).bind(householdId, Date.now()).first<{ code: string }>()
  const code = existing?.code ?? inviteCode()
  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO invites (code,household_id,created_by,email,created_at,expires_at) VALUES (?1,?2,?3,NULL,?4,?5)'
    ).bind(code, householdId, auth.user.id, Date.now(), Date.now() + 72 * 60 * 60 * 1000).run()
  }
  const expiresAt = Date.now() + 72 * 60 * 60 * 1000
  return json({
    status: 'created',
    code,
    inviteUrl: `${env.APP_URL}/invite/${code}`,
    householdName: household?.name ?? 'Cacotas',
    inviterName: auth.user.display_name ?? auth.user.email ?? 'Un miembro',
    expiresAt,
  })
}

const handleAcceptInvite = async (request: Request, env: Env): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  if (auth.user.household_id !== null) return json({ error: 'already in household' }, 409)
  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  if (typeof body !== 'object' || body === null) return json({ error: 'invalid payload' }, 400)
  const code = typeof (body as Record<string, unknown>).code === 'string' ? String((body as Record<string, unknown>).code) : ''
  const invite = await env.DB.prepare(
    'SELECT i.code,i.household_id,i.expires_at,h.name,u.display_name AS inviter_name FROM invites i JOIN households h ON h.id=i.household_id LEFT JOIN users u ON u.id=i.created_by WHERE i.code=?1 AND i.redeemed_at IS NULL AND i.rejected_at IS NULL AND i.expires_at>?2'
  ).bind(code, Date.now()).first<{ code: string; household_id: string; expires_at: number; name: string; inviter_name: string | null }>()
  if (!invite) return json({ error: 'invalid invitation' }, 400)
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET household_id=?1 WHERE id=?2 AND household_id IS NULL').bind(invite.household_id, auth.user.id),
      env.DB.prepare('UPDATE invites SET redeemed_at=?2,redeemed_by=?3 WHERE code=?1 AND redeemed_at IS NULL AND rejected_at IS NULL AND expires_at>?4').bind(code, Date.now(), auth.user.id, Date.now()),
    ])
  } catch {
    return json({ error: 'household full' }, 409)
  }
  const membership = await env.DB.prepare('SELECT household_id FROM users WHERE id=?1').bind(auth.user.id).first<{ household_id: string | null }>()
  if (membership?.household_id !== invite.household_id) return json({ error: 'invitation unavailable' }, 409)
  return json({ householdId: invite.household_id, householdName: invite.name, inviterName: invite.inviter_name })
}

const handleRejectInvite = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  if (auth.user.household_id !== null) {
    return json({ error: 'already in household' }, 409)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'invalid payload' }, 400)
  }

  const code =
    typeof (body as Record<string, unknown>).code === 'string'
      ? String((body as Record<string, unknown>).code)
      : ''
  const result = await env.DB.prepare(
    'UPDATE invites SET rejected_at=?2,rejected_by=?3 WHERE code=?1 AND redeemed_at IS NULL AND rejected_at IS NULL AND expires_at>?4',
  ).bind(code, Date.now(), auth.user.id, Date.now()).run()

  return result.meta.changes === 0
    ? json({ error: 'invalid invitation' }, 400)
    : json({ status: 'rejected' })
}

const deleteHouseholdData = (env: Env, householdId: string) => [
  env.DB.prepare('DELETE FROM invites WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM notification_log WHERE household_id=?1').bind(householdId),
  env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE user_id IN (SELECT id FROM users WHERE household_id=?1)',
  ).bind(householdId),
  env.DB.prepare('DELETE FROM baby_sequences WHERE baby_id IN (SELECT id FROM babies WHERE household_id=?1)').bind(householdId),
  env.DB.prepare('DELETE FROM movements WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM weights WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM locations WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM babies WHERE household_id=?1').bind(householdId),
  env.DB.prepare(
    'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE household_id=?1)',
  ).bind(householdId),
  env.DB.prepare('DELETE FROM users WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM households WHERE id=?1').bind(householdId),
]

const handleLeaveHousehold = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const householdId = requireHousehold(auth)
  if (householdId instanceof Response) return householdId

  const other = await env.DB.prepare(
    'SELECT id FROM users WHERE household_id=?1 AND id<>?2 LIMIT 1',
  )
    .bind(householdId, auth.user.id)
    .first()

  if (other) {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET household_id=NULL WHERE id=?1').bind(
        auth.user.id,
      ),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?1').bind(
        auth.user.id,
      ),
    ])
  } else {
    await env.DB.batch(deleteHouseholdData(env, householdId))
  }

  return json({ status: 'left' })
}

const handleDeleteAccount = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth

  const householdId = auth.user.household_id
  if (householdId === null) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?1').bind(auth.user.id),
      env.DB.prepare('DELETE FROM users WHERE id=?1').bind(auth.user.id),
    ])
    return json({ status: 'deleted' })
  }

  const other = await env.DB.prepare(
    'SELECT id FROM users WHERE household_id=?1 AND id<>?2 LIMIT 1',
  )
    .bind(householdId, auth.user.id)
    .first()

  if (other) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?1').bind(auth.user.id),
      env.DB.prepare('UPDATE users SET household_id=NULL WHERE id=?1').bind(
        auth.user.id,
      ),
    ])
  } else {
    await env.DB.batch(deleteHouseholdData(env, householdId))
  }

  return json({ status: 'deleted' })
}

export const handleSingleMovement = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const householdId = requireHousehold(auth)
  if (householdId instanceof Response) return householdId
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
  if (r.locationId !== undefined && (typeof r.locationId !== 'string' || r.locationId === '')) {
    return json({ error: 'invalid locationId' }, 400)
  }

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

  const babyRow = await env.DB.prepare(
    'SELECT id FROM babies WHERE household_id=?1 ORDER BY created_at,id LIMIT 1',
  )
    .bind(householdId)
    .first<{ id: string }>()
  if (!babyRow) return json({ error: 'no baby configured yet' }, 400)

  const sizeRow = await env.DB.prepare(
    `SELECT size_id FROM movements WHERE household_id=?1 AND baby_id=?2 AND type = 'SIZE_CHANGE'
     ORDER BY occurred_at DESC LIMIT 1`
  ).bind(householdId, babyRow.id).first<{ size_id: number }>()
  if (!sizeRow) return json({ error: 'no size configured yet' }, 400)

  const locationId = resolveMovementLocationId(babyRow.id, typeof r.locationId === 'string' ? r.locationId : undefined)
  const location = await env.DB.prepare('SELECT id FROM locations WHERE id = ?1 AND household_id = ?2').bind(locationId, householdId).first<{ id: string }>()
  if (!location) return json({ error: 'location not found' }, 400)

  const movement = createMovement(
    {
      id: crypto.randomUUID(),
      babyId: babyRow.id,
      sizeId: sizeRow.size_id,
      locationId,
      deviceId: r.deviceId,
      occurredAt: now,
      recordedAt: now,
    },
    { type: 'USAGE', usageSource: r.usageSource, quantity: 1 }
  )

  const seqResult = await env.DB.batch([
    env.DB.prepare('INSERT INTO baby_sequences (baby_id,next_seq) VALUES (?1,2) ON CONFLICT(baby_id) DO UPDATE SET next_seq=next_seq+1').bind(movement.babyId),
    env.DB.prepare(
      `INSERT INTO movements (id,household_id,baby_id,baby_seq,size_id,type,usage_source,quantity,delta,occurred_at,recorded_at,device_id,location_id)
       VALUES (?1,?2,?3,(SELECT next_seq-1 FROM baby_sequences WHERE baby_id=?3),?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
    ).bind(movement.id, householdId, movement.babyId, movement.sizeId, movement.type, movement.usageSource ?? null, movement.quantity, movement.delta, movement.occurredAt, movement.recordedAt, movement.deviceId, movement.locationId ?? null),
  ])
  const serverSeq = Number((await env.DB.prepare('SELECT baby_seq FROM movements WHERE id=?1').bind(movement.id).first<{ baby_seq: number }>())?.baby_seq ?? 0)
  return json({ movement: { ...movement, serverSeq } }, 200)
}

const handlePushSubscribe = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  if (auth.user.household_id === null) return json({ error: 'household required' }, 409)
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
    `INSERT INTO push_subscriptions (device_id, user_id, endpoint, keys_json)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(device_id) DO UPDATE SET
       user_id = excluded.user_id,
       endpoint = excluded.endpoint,
       keys_json = excluded.keys_json`
  )
    .bind(r.deviceId, auth.user.id, r.endpoint, JSON.stringify(keys))
    .run()
  return json({ status: 'subscribed' })
}

const handleSnooze = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const householdId = requireHousehold(auth)
  if (householdId instanceof Response) return householdId
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
     WHERE baby_id = ?1 AND size_id = ?2 AND kind = ?3 AND household_id = ?5`
  )
    .bind(r.babyId, r.sizeId, r.kind, r.snoozedUntil, householdId)
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

      switch (url.pathname) {
        case '/auth/google':
          return handleGoogleAuth(request, env)
        case '/sync':
          return handleSync(request, env)
        case '/household/status':
          return handleHouseholdStatus(request, env)
        case '/household/create':
          return handleCreateHousehold(request, env)
        case '/household/invite':
          return handleInvite(request, env)
        case '/household/invite/accept':
          return handleAcceptInvite(request, env)
        case '/household/invite/reject':
          return handleRejectInvite(request, env)
        case '/household/leave':
          return handleLeaveHousehold(request, env)
        case '/account/delete':
          return handleDeleteAccount(request, env)
        case '/movement':
          return handleSingleMovement(request, env)
        case '/push-subscribe':
          return handlePushSubscribe(request, env)
        case '/snooze':
          return handleSnooze(request, env)
        default:
          return json({ error: 'not found' }, 404)
      }
    })()
  },
}const handleInvite = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const householdId = requireHousehold(auth)
  if (householdId instanceof Response) return householdId

  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM users WHERE household_id=?1',
  )
    .bind(householdId)
    .first<{ count: number }>()
  if ((count?.count ?? 0) >= 2) {
    return json({ error: 'household full' }, 409)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'invalid payload' }, 400)
  }

  const email =
    typeof (body as Record<string, unknown>).email === 'string'
      ? normalizeEmail(String((body as Record<string, unknown>).email))
      : ''
  if (!email || !email.includes('@')) {
    return json({ error: 'invalid email' }, 400)
  }

  const existing = await env.DB.prepare(
    'SELECT code FROM invites WHERE household_id=?1 AND email=?2 AND redeemed_at IS NULL AND rejected_at IS NULL AND expires_at>?3',
  )
    .bind(householdId, email, Date.now())
    .first<{ code: string }>()
  const code = existing?.code ?? inviteCode()

  if (!existing) {
    const now = Date.now()
    await env.DB.prepare(
      'INSERT INTO invites (code,household_id,created_by,email,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6)',
    )
      .bind(
        code,
        householdId,
        auth.user.id,
        email,
        now,
        now + 72 * 60 * 60 * 1000,
      )
      .run()
  }

  return json({ status: existing ? 'already_pending' : 'pending' })
}

const inviteIp = (request: Request): string =>
  request.headers.get('CF-Connecting-IP') ?? 'unknown'

const inviteRateLimited = async (
  request: Request,
  env: Env,
): Promise<boolean> => {
  const ip = inviteIp(request)
  const cutoff = Date.now() - 60 * 60 * 1000
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM invite_attempts WHERE ip=?1 AND attempted_at>?2',
  )
    .bind(ip, cutoff)
    .first<{ count: number }>()
  return (row?.count ?? 0) >= 10
}

const recordInviteFailure = async (
  request: Request,
  env: Env,
): Promise<void> => {
  await env.DB.prepare(
    'INSERT INTO invite_attempts (ip,attempted_at) VALUES (?1,?2)',
  )
    .bind(inviteIp(request), Date.now())
    .run()
}

const handleAcceptInvite = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  if (auth.user.household_id !== null) {
    return json({ error: 'already in household' }, 409)
  }
  if (await inviteRateLimited(request, env)) {
    return json({ error: 'invalid invitation' }, 400)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'invalid payload' }, 400)
  }

  const code =
    typeof (body as Record<string, unknown>).code === 'string'
      ? String((body as Record<string, unknown>).code)
      : ''
  const invite = await env.DB.prepare(
    'SELECT code,household_id,email FROM invites WHERE code=?1 AND redeemed_at IS NULL AND rejected_at IS NULL AND expires_at>?2',
  )
    .bind(code, Date.now())
    .first<{ code: string; household_id: string; email: string }>()

  if (!invite || invite.email !== normalizeEmail(auth.user.email ?? '')) {
    await recordInviteFailure(request, env)
    return json({ error: 'invalid invitation' }, 400)
  }

  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM users WHERE household_id=?1',
  )
    .bind(invite.household_id)
    .first<{ count: number }>()
  if ((count?.count ?? 0) >= 2) {
    return json({ error: 'household full' }, 409)
  }

  try {
    const result = await env.DB.batch([
      env.DB.prepare(
        'UPDATE users SET household_id=?1 WHERE id=?2 AND household_id IS NULL',
      ).bind(invite.household_id, auth.user.id),
      env.DB.prepare(
        'UPDATE invites SET redeemed_at=?2,redeemed_by=?3 WHERE code=?1 AND redeemed_at IS NULL',
      ).bind(code, Date.now(), auth.user.id),
    ])
    if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1) {
      return json({ error: 'invalid invitation' }, 400)
    }
  } catch {
    return json({ error: 'household full' }, 409)
  }

  return json({ householdId: invite.household_id })
}

const handleRejectInvite = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  if (auth.user.household_id !== null) {
    return json({ error: 'already in household' }, 409)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'invalid payload' }, 400)
  }

  const code =
    typeof (body as Record<string, unknown>).code === 'string'
      ? String((body as Record<string, unknown>).code)
      : ''
  const result = await env.DB.prepare(
    'UPDATE invites SET rejected_at=?2,rejected_by=?3 WHERE code=?1 AND email=?4 AND redeemed_at IS NULL AND rejected_at IS NULL',
  )
    .bind(
      code,
      Date.now(),
      auth.user.id,
      normalizeEmail(auth.user.email ?? ''),
    )
    .run()

  return result.meta.changes === 0
    ? json({ error: 'invalid invitation' }, 400)
    : json({ status: 'rejected' })
}

const deleteHouseholdData = (env: Env, householdId: string) => [
  env.DB.prepare('DELETE FROM invites WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM notification_log WHERE household_id=?1').bind(householdId),
  env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE user_id IN (SELECT id FROM users WHERE household_id=?1)',
  ).bind(householdId),
  env.DB.prepare('DELETE FROM baby_sequences WHERE baby_id IN (SELECT id FROM babies WHERE household_id=?1)').bind(householdId),
  env.DB.prepare('DELETE FROM movements WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM weights WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM locations WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM babies WHERE household_id=?1').bind(householdId),
  env.DB.prepare(
    'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE household_id=?1)',
  ).bind(householdId),
  env.DB.prepare('DELETE FROM users WHERE household_id=?1').bind(householdId),
  env.DB.prepare('DELETE FROM households WHERE id=?1').bind(householdId),
]

const handleLeaveHousehold = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const householdId = requireHousehold(auth)
  if (householdId instanceof Response) return householdId

  const other = await env.DB.prepare(
    'SELECT id FROM users WHERE household_id=?1 AND id<>?2 LIMIT 1',
  )
    .bind(householdId, auth.user.id)
    .first()

  if (other) {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET household_id=NULL WHERE id=?1').bind(
        auth.user.id,
      ),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?1').bind(
        auth.user.id,
      ),
    ])
  } else {
    await env.DB.batch(deleteHouseholdData(env, householdId))
  }

  return json({ status: 'left' })
}

const handleDeleteAccount = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth

  const householdId = auth.user.household_id
  if (householdId === null) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?1').bind(auth.user.id),
      env.DB.prepare('DELETE FROM users WHERE id=?1').bind(auth.user.id),
    ])
    return json({ status: 'deleted' })
  }

  const other = await env.DB.prepare(
    'SELECT id FROM users WHERE household_id=?1 AND id<>?2 LIMIT 1',
  )
    .bind(householdId, auth.user.id)
    .first()

  if (other) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?1').bind(auth.user.id),
      env.DB.prepare('UPDATE users SET household_id=NULL WHERE id=?1').bind(
        auth.user.id,
      ),
    ])
  } else {
    await env.DB.batch(deleteHouseholdData(env, householdId))
  }

  return json({ status: 'deleted' })
}

export const handleSingleMovement = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const householdId = requireHousehold(auth)
  if (householdId instanceof Response) return householdId
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
  if (r.locationId !== undefined && (typeof r.locationId !== 'string' || r.locationId === '')) {
    return json({ error: 'invalid locationId' }, 400)
  }

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

  const babyRow = await env.DB.prepare(
    'SELECT id FROM babies WHERE household_id=?1 ORDER BY created_at,id LIMIT 1',
  )
    .bind(householdId)
    .first<{ id: string }>()
  if (!babyRow) return json({ error: 'no baby configured yet' }, 400)

  const sizeRow = await env.DB.prepare(
    `SELECT size_id FROM movements WHERE household_id=?1 AND baby_id=?2 AND type = 'SIZE_CHANGE'
     ORDER BY occurred_at DESC LIMIT 1`
  ).bind(householdId, babyRow.id).first<{ size_id: number }>()
  if (!sizeRow) return json({ error: 'no size configured yet' }, 400)

  const locationId = resolveMovementLocationId(babyRow.id, typeof r.locationId === 'string' ? r.locationId : undefined)
  const location = await env.DB.prepare('SELECT id FROM locations WHERE id = ?1 AND household_id = ?2').bind(locationId, householdId).first<{ id: string }>()
  if (!location) return json({ error: 'location not found' }, 400)

  const movement = createMovement(
    {
      id: crypto.randomUUID(),
      babyId: babyRow.id,
      sizeId: sizeRow.size_id,
      locationId,
      deviceId: r.deviceId,
      occurredAt: now,
      recordedAt: now,
    },
    { type: 'USAGE', usageSource: r.usageSource, quantity: 1 }
  )

  await env.DB.prepare(
    `INSERT INTO movements
       (id, baby_id, size_id, type, usage_source, quantity, delta,
        occurred_at, recorded_at, device_id, location_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
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
      movement.deviceId,
      movement.locationId ?? null
    )
    .run()

  return json({ movement: { ...movement, serverSeq: 0 } }, 200)
}

const handlePushSubscribe = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  if (auth.user.household_id === null) return json({ error: 'household required' }, 409)
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
    `INSERT INTO push_subscriptions (device_id, user_id, endpoint, keys_json)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(device_id) DO UPDATE SET
       user_id = excluded.user_id,
       endpoint = excluded.endpoint,
       keys_json = excluded.keys_json`
  )
    .bind(r.deviceId, auth.user.id, r.endpoint, JSON.stringify(keys))
    .run()
  return json({ status: 'subscribed' })
}

const handleSnooze = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const auth = await authenticate(request, env)
  if (auth instanceof Response) return auth
  const householdId = requireHousehold(auth)
  if (householdId instanceof Response) return householdId
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
     WHERE baby_id = ?1 AND size_id = ?2 AND kind = ?3 AND household_id = ?5`
  )
    .bind(r.babyId, r.sizeId, r.kind, r.snoozedUntil, householdId)
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

      switch (url.pathname) {
        case '/auth/google':
          return handleGoogleAuth(request, env)
        case '/sync':
          return handleSync(request, env)
        case '/household/status':
          return handleHouseholdStatus(request, env)
        case '/household/create':
          return handleCreateHousehold(request, env)
        case '/household/invite':
          return handleInvite(request, env)
        case '/household/invite/accept':
          return handleAcceptInvite(request, env)
        case '/household/invite/reject':
          return handleRejectInvite(request, env)
        case '/household/leave':
          return handleLeaveHousehold(request, env)
        case '/account/delete':
          return handleDeleteAccount(request, env)
        case '/movement':
          return handleSingleMovement(request, env)
        case '/push-subscribe':
          return handlePushSubscribe(request, env)
        case '/snooze':
          return handleSnooze(request, env)
        case '/run-notifications': {
          const auth = await authenticate(request, env)
          if (auth instanceof Response) return auth
          return runNotifications(env).then((result) => json(result))
        }
        default:
          return json({ error: 'not found' }, 404)
      }
    })()
  },
}
