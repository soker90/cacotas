import { computeForecast } from '../shared/forecast.ts'
import {
  hashState,
  isPurchaseDay,
  shouldNotify,
  type LogEntry,
} from '../shared/notifications.ts'
import type {
  Movement,
  MovementType,
  UsageSource,
} from '../shared/types.ts'
import { sendPush } from './push.ts'
import type { Env } from './index.ts'

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

const rowToMovement = (row: MovementRow): Movement => ({
  id: row.id,
  babyId: row.baby_id,
  sizeId: row.size_id,
  type: row.type as MovementType,
  ...(row.usage_source !== null
    ? { usageSource: row.usage_source as UsageSource }
    : {}),
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

export interface NotifyResult {
  checkedAt: number
  sent: Array<{ kind: string; sizeId: number; devices: number }>
  skipped: Array<{ kind: string; sizeId: number; reason: string }>
}

/** Madrid "now" without pulling a timezone library. */
const madridNow = (): { hour: number; weekday: number } => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? ''
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return {
    hour: Number.parseInt(get('hour'), 10) % 24,
    weekday: weekdays[get('weekday')] ?? -1,
  }
}

/**
 * Runs the daily notification pass (SPEC.md §12). Uses THE SAME forecast
 * engine from /shared — never a copy.
 */
export const runNotifications = async (env: Env): Promise<NotifyResult> => {
  const result: NotifyResult = {
    checkedAt: Date.now(),
    sent: [],
    skipped: [],
  }

  // ── Gather ledger state ───────────────────────────────
  const movementRows = await env.DB.prepare(
    'SELECT * FROM movements ORDER BY seq'
  ).all<MovementRow>()
  const all = (movementRows.results ?? []).map(rowToMovement)

  const babyRow = await env.DB.prepare(
    'SELECT * FROM babies LIMIT 1'
  ).first<{ id: string; name: string }>()

  const subscriptions = await env.DB.prepare(
    'SELECT endpoint, keys_json FROM push_subscriptions'
  ).all<{ endpoint: string; keys_json: string }>()

  const vapid = {
    privateKeyB64url: env.VAPID_PRIVATE_KEY,
    publicKeyB64url: env.VAPID_PUBLIC_KEY,
    subject: env.VAPID_SUBJECT,
  }

  if (
    babyRow === null ||
    (subscriptions.results?.length ?? 0) === 0 ||
    env.VAPID_PRIVATE_KEY === ''
  ) {
    return result
  }
  const devices = (subscriptions.results ?? []).map((row) => ({
    endpoint: row.endpoint,
    keys: JSON.parse(row.keys_json) as { p256dh: string; auth: string },
  }))

  // ── Live ledger view (undone excluded, §6) ────────────
  const undone = new Set(
    all.filter((m) => m.type === 'UNDO').map((m) => m.undoesMovementId ?? '')
  )
  const liveUsage = all.filter(
    (m) => m.type === 'USAGE' && !undone.has(m.id)
  )
  const stockBySize = new Map<number, number>()
  for (const m of all) {
    stockBySize.set(m.sizeId, (stockBySize.get(m.sizeId) ?? 0) + m.delta)
  }
  const sizeChanges = all
    .filter((m) => m.type === 'SIZE_CHANGE')
    .sort((a, b) => a.occurredAt - b.occurredAt)
  const currentSize = sizeChanges.at(-1)?.sizeId

  if (currentSize === undefined) return result
  const currentStock = stockBySize.get(currentSize) ?? 0

  // Signals are device-local (§17) and not synced, and the Worker has no
  // size table — transition stays null server-side and BUY_BOTH_SIZES
  // degrades to plain BUY_NOW. Documented limitation.
  const forecast = computeForecast({
    stock: currentStock,
    usage: liveUsage,
    now: Date.now(),
    transition: null,
    warningDays: 7,
    coverageDays: 21,
  })

  const madrid = madridNow()
  const now = Date.now()

  // ── Candidate notifications ───────────────────────────
  const candidates: Array<{
    kind: string
    sizeId: number
    condition: boolean
    body: string
    hashParts: unknown
  }> = [
    {
      kind: 'STOCK_LOW',
      sizeId: currentSize,
      condition:
        forecast.daysRemaining !== null &&
        forecast.daysRemaining <= 7 &&
        forecast.status !== 'NO_DATA',
      body: `Quedan ≈ ${String(forecast.daysRemaining ?? 0)} días de pañales (talla ${String(currentSize)}).`,
      hashParts: {
        kind: 'STOCK_LOW',
        daysRemaining: forecast.daysRemaining,
        stock: currentStock,
        sizeId: currentSize,
      },
    },
    {
      kind: 'PURCHASE_RECOMMENDED',
      sizeId: currentSize,
      condition:
        (forecast.status === 'BUY_NOW' ||
          forecast.status === 'BUY_BOTH_SIZES') &&
        // Thursday anchoring (§12 "a considerar"): Mon-Wed reminders are
        // forgotten before the big shop
        isPurchaseDay(madrid.weekday),
      body:
        forecast.recommendedDiapers !== null && forecast.recommendedDiapers > 0
          ? `Conviene comprar ≈ ${String(forecast.recommendedDiapers)} pañales de talla ${String(currentSize)}.`
          : `Conviene comprar pañales de talla ${String(currentSize)}.`,
      hashParts: {
        kind: 'PURCHASE_RECOMMENDED',
        recommendedDiapers: forecast.recommendedDiapers,
        dailyConsumption: forecast.dailyConsumption,
        sizeId: currentSize,
      },
    },
  ]

  for (const candidate of candidates) {
    if (!candidate.condition) continue

    const stateHash = await hashState(candidate.hashParts)
    const logRow = await env.DB.prepare(
      `SELECT state_hash, sent_at, snoozed_until FROM notification_log
       WHERE baby_id = ?1 AND size_id = ?2 AND kind = ?3`
    )
      .bind(babyRow.id, candidate.sizeId, candidate.kind)
      .first<{ state_hash: string; sent_at: number; snoozed_until: number | null }>()

    const last: LogEntry | null =
      logRow !== null
        ? {
            state_hash: logRow.state_hash,
            sent_at: logRow.sent_at,
            snoozed_until: logRow.snoozed_until,
          }
        : null

    const decision = shouldNotify(last, stateHash, now)
    if (!decision.send) {
      result.skipped.push({
        kind: candidate.kind,
        sizeId: candidate.sizeId,
        reason: decision.reason,
      })
      continue
    }

    let delivered = 0
    for (const device of devices) {
      try {
        const status = await sendPush(
          device,
          JSON.stringify({
            title: 'Cacotas',
            body: candidate.body,
            tag: `${candidate.kind}-${String(candidate.sizeId)}`,
            data: {
              babyId: babyRow.id,
              sizeId: candidate.sizeId,
              kind: candidate.kind,
            },
            actions: [{ action: 'snooze', title: 'Me encargo yo' }],
          }),
          vapid
        )
        // 404/410 = expired subscription: drop it
        if (status === 404 || status === 410) {
          await env.DB.prepare(
            'DELETE FROM push_subscriptions WHERE endpoint = ?1'
          )
            .bind(device.endpoint)
            .run()
        } else if (status >= 200 && status < 300) {
          delivered++
        }
      } catch {
        // One failing device never blocks the rest
      }
    }

    await env.DB.prepare(
      `INSERT INTO notification_log
         (baby_id, size_id, kind, state_hash, sent_at, snoozed_until)
       VALUES (?1, ?2, ?3, ?4, ?5, NULL)
       ON CONFLICT(baby_id, size_id, kind) DO UPDATE SET
         state_hash = excluded.state_hash,
         sent_at = excluded.sent_at,
         snoozed_until = NULL`
    )
      .bind(
        babyRow.id,
        candidate.sizeId,
        candidate.kind,
        stateHash,
        Date.now()
      )
      .run()

    result.sent.push({
      kind: candidate.kind,
      sizeId: candidate.sizeId,
      devices: delivered,
    })
  }

  return result
}

export { madridNow }
