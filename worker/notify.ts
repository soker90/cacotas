import { getUpcomingDoseTimes, isAppointmentReminderDue, isDoseReminderDue, plannedDoseId, type MedicalAppointment, type Treatment } from '../shared/health.ts'
import { computeForecast } from '../shared/forecast.ts'
import { DODOT_SIZES } from '../shared/transition.ts'
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
  baby_seq: number
  household_id: string
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
  serverSeq: row.baby_seq,
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
  const result: NotifyResult = { checkedAt: Date.now(), sent: [], skipped: [] }
  const babies = (await env.DB.prepare(
    'SELECT id,name,household_id FROM babies ORDER BY created_at,id'
  ).all<{ id: string; name: string; household_id: string }>()).results ?? []

  for (const babyRow of babies) {
    const movementRows = await env.DB.prepare(
      'SELECT * FROM movements WHERE household_id=?1 AND baby_id=?2 ORDER BY baby_seq'
    ).bind(babyRow.household_id, babyRow.id).all<MovementRow>()
    const all = (movementRows.results ?? []).map(rowToMovement)
    const subscriptions = (await env.DB.prepare(
      'SELECT ps.endpoint, ps.keys_json FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.household_id=?1'
    ).bind(babyRow.household_id).all<{ endpoint: string; keys_json: string }>()).results ?? []
    if (subscriptions.length === 0 || env.VAPID_PRIVATE_KEY === '') continue

    const devices = subscriptions.map((row) => ({
      endpoint: row.endpoint,
      keys: JSON.parse(row.keys_json) as { p256dh: string; auth: string },
    }))
    const undone = new Set(all.filter((m) => m.type === 'UNDO').map((m) => m.undoesMovementId ?? ''))
    const liveUsage = all.filter((m) => m.type === 'USAGE' && !undone.has(m.id))
    const stockBySize = new Map<number, number>()
    for (const m of all) stockBySize.set(m.sizeId, (stockBySize.get(m.sizeId) ?? 0) + m.delta)
    const currentSize = all.filter((m) => m.type === 'SIZE_CHANGE').sort((a, b) => a.occurredAt - b.occurredAt).at(-1)?.sizeId
    if (currentSize === undefined) continue
    const currentStock = stockBySize.get(currentSize) ?? 0
    const forecast = computeForecast({
      stock: currentStock,
      usage: liveUsage,
      now: Date.now(),
      transition: null,
      currentSize: DODOT_SIZES.find((s) => s.id === currentSize) ?? null,
      warningDays: 7,
      coverageDays: 21,
    })
    const madrid = madridNow()
    const now = Date.now()
    const candidates = [
      {
        kind: 'STOCK_LOW',
        sizeId: currentSize,
        condition: forecast.daysRemaining !== null && forecast.daysRemaining <= 7 && forecast.status !== 'NO_DATA',
        body: `${babyRow.name}: quedan ≈ ${String(forecast.daysRemaining ?? 0)} días de pañales (talla ${String(currentSize)}).`,
        hashParts: { kind: 'STOCK_LOW', daysRemaining: forecast.daysRemaining, stock: currentStock, sizeId: currentSize },
      },
      {
        kind: 'PURCHASE_RECOMMENDED',
        sizeId: currentSize,
        condition: (forecast.status === 'BUY_NOW' || forecast.status === 'BUY_BOTH_SIZES') && isPurchaseDay(madrid.weekday),
        body: forecast.recommendedDiapers !== null && forecast.recommendedDiapers > 0
          ? `${babyRow.name}: conviene comprar ≈ ${String(forecast.recommendedDiapers)} pañales de talla ${String(currentSize)}.`
          : `${babyRow.name}: conviene comprar pañales de talla ${String(currentSize)}.`,
        hashParts: { kind: 'PURCHASE_RECOMMENDED', recommendedDiapers: forecast.recommendedDiapers, dailyConsumption: forecast.dailyConsumption, sizeId: currentSize },
      },
    ]

    for (const candidate of candidates) {
      if (!candidate.condition) continue
      const stateHash = await hashState(candidate.hashParts)
      const logRow = await env.DB.prepare(
        'SELECT state_hash,sent_at,snoozed_until FROM notification_log WHERE household_id=?1 AND baby_id=?2 AND size_id=?3 AND kind=?4'
      ).bind(babyRow.household_id, babyRow.id, candidate.sizeId, candidate.kind).first<{ state_hash: string; sent_at: number; snoozed_until: number | null }>()
      const last: LogEntry | null = logRow === null ? null : { state_hash: logRow.state_hash, sent_at: logRow.sent_at, snoozed_until: logRow.snoozed_until }
      const decision = shouldNotify(last, stateHash, now)
      if (!decision.send) {
        result.skipped.push({ kind: candidate.kind, sizeId: candidate.sizeId, reason: decision.reason })
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
              tag: `${babyRow.id}-${candidate.kind}-${String(candidate.sizeId)}`,
              data: { babyId: babyRow.id, sizeId: candidate.sizeId, kind: candidate.kind },
              actions: [{ action: 'snooze', title: 'Me encargo yo' }],
            }),
            { privateKeyB64url: env.VAPID_PRIVATE_KEY, publicKeyB64url: env.VAPID_PUBLIC_KEY, subject: env.VAPID_SUBJECT }
          )
          if (status === 404 || status === 410) {
            await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?1').bind(device.endpoint).run()
          } else if (status >= 200 && status < 300) delivered++
        } catch {
          // A failing device never blocks the rest.
        }
      }
      await env.DB.prepare(
        `INSERT INTO notification_log (household_id,baby_id,size_id,kind,state_hash,sent_at,snoozed_until)
         VALUES (?1,?2,?3,?4,?5,?6,NULL)
         ON CONFLICT(baby_id,size_id,kind) DO UPDATE SET state_hash=excluded.state_hash,sent_at=excluded.sent_at,snoozed_until=NULL`
      ).bind(babyRow.household_id, babyRow.id, candidate.sizeId, candidate.kind, stateHash, Date.now()).run()
      result.sent.push({ kind: candidate.kind, sizeId: candidate.sizeId, devices: delivered })
    }
  }
  return result
}
export { madridNow }

export interface HealthNotifyResult {
  checkedAt: number
  sent: number
  skipped: number
}

type HealthPushOutcome = 'sent' | 'duplicate' | 'expired' | 'failed'

const sendHealthPushOnce = async (
  env: Env,
  notificationKey: string,
  householdId: string,
  device: Parameters<typeof sendPush>[0] & { deviceId: string },
  payload: string,
  now: number
): Promise<HealthPushOutcome> => {
  const claim = await env.DB.prepare(
    'INSERT OR IGNORE INTO health_notification_log (notification_key, household_id, device_id, sent_at) VALUES (?1,?2,?3,?4) RETURNING notification_key'
  ).bind(notificationKey, householdId, device.deviceId, now).first<{ notification_key: string }>()
  if (claim === null) return 'duplicate'
  try {
    const status = await sendPush(
      device,
      payload,
      { privateKeyB64url: env.VAPID_PRIVATE_KEY, publicKeyB64url: env.VAPID_PUBLIC_KEY, subject: env.VAPID_SUBJECT }
    )
    if (status === 404 || status === 410) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE device_id=?1').bind(device.deviceId).run()
      await env.DB.prepare('DELETE FROM health_notification_log WHERE notification_key=?1 AND device_id=?2')
        .bind(notificationKey, device.deviceId).run()
      return 'expired'
    }
    if (status < 200 || status >= 300) {
      await env.DB.prepare('DELETE FROM health_notification_log WHERE notification_key=?1 AND device_id=?2')
        .bind(notificationKey, device.deviceId).run()
      return 'failed'
    }
    return 'sent'
  } catch {
    await env.DB.prepare('DELETE FROM health_notification_log WHERE notification_key=?1 AND device_id=?2')
      .bind(notificationKey, device.deviceId).run()
    return 'failed'
  }
}

/** Send medication and appointment reminders from the hourly cron. */
export const runHealthNotifications = async (env: Env): Promise<HealthNotifyResult> => {
  const now = Date.now()
  const result: HealthNotifyResult = { checkedAt: now, sent: 0, skipped: 0 }
  const babies = (await env.DB.prepare(
    'SELECT id, household_id, name FROM babies ORDER BY created_at,id'
  ).all<{ id: string; household_id: string; name: string }>()).results ?? []

  for (const baby of babies) {
    const subscriptions = (await env.DB.prepare(
      'SELECT ps.device_id, ps.endpoint, ps.keys_json FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.household_id=?1'
    ).bind(baby.household_id).all<{ device_id: string; endpoint: string; keys_json: string }>()).results ?? []
    if (subscriptions.length === 0 || env.VAPID_PRIVATE_KEY === '') continue
    const devices = subscriptions.map((row) => ({
      deviceId: row.device_id,
      endpoint: row.endpoint,
      keys: JSON.parse(row.keys_json) as { p256dh: string; auth: string },
    }))

    const treatmentRows = (await env.DB.prepare(
      'SELECT record_json FROM treatments WHERE household_id=?1 AND baby_id=?2'
    ).bind(baby.household_id, baby.id).all<{ record_json: string }>()).results ?? []
    for (const row of treatmentRows) {
      const treatment = JSON.parse(row.record_json) as Treatment
      if (treatment.status !== 'active') continue
      const candidates = getUpcomingDoseTimes(treatment, now - 1, now + 60 * 60 * 1000)
        .filter((scheduledAt) => isDoseReminderDue(scheduledAt, now))
      for (const scheduledAt of candidates) {
        const doseId = plannedDoseId(treatment.id, scheduledAt)
        const recorded = await env.DB.prepare('SELECT id FROM dose_records WHERE id=?1 AND household_id=?2')
          .bind(doseId, baby.household_id).first()
        if (recorded !== null) {
          result.skipped++
          continue
        }
        const notificationKey = `medication:${doseId}`
        for (const device of devices) {
          const outcome = await sendHealthPushOnce(
            env,
            notificationKey,
            baby.household_id,
            device,
            JSON.stringify({
              title: 'Recordatorio de medicación',
              body: `${baby.name}: toca ${treatment.name}.`,
              tag: notificationKey,
              data: { kind: 'MEDICATION', babyId: baby.id, treatmentId: treatment.id, scheduledAt },
            }),
            now
          )
          if (outcome === 'sent') result.sent++
          else if (outcome === 'failed' || outcome === 'expired') result.skipped++
        }
      }
    }

    const appointmentRows = (await env.DB.prepare(
      'SELECT record_json FROM medical_appointments WHERE household_id=?1 AND baby_id=?2'
    ).bind(baby.household_id, baby.id).all<{ record_json: string }>()).results ?? []
    for (const row of appointmentRows) {
      const appointment = JSON.parse(row.record_json) as MedicalAppointment
      if (!isAppointmentReminderDue(appointment, now)) continue
      const notificationKey = `appointment:${appointment.id}:${appointment.startsAt}`
      for (const device of devices) {
        const outcome = await sendHealthPushOnce(
          env,
          notificationKey,
          baby.household_id,
          device,
          JSON.stringify({
            title: 'Recordatorio de cita médica',
            body: `${baby.name}: ${appointment.title} mañana.`,
            tag: notificationKey,
            data: { kind: 'APPOINTMENT', babyId: baby.id, appointmentId: appointment.id },
          }),
          now
        )
        if (outcome === 'sent') result.sent++
        else if (outcome === 'failed' || outcome === 'expired') result.skipped++
      }
    }
  }
  return result
}
