import type { UUID } from './types.ts'

export type TreatmentStatus = 'active' | 'paused' | 'finished'
export type TreatmentSchedule =
  | { kind: 'daily'; times: string[] }
  | { kind: 'interval'; everyHours: number }

export interface Treatment {
  id: UUID
  babyId: UUID
  name: string
  activeIngredient?: string
  notes?: string
  instructions?: string
  schedule: TreatmentSchedule
  startsAt: number
  endsAt?: number
  status: TreatmentStatus
  createdAt: number
  updatedAt: number
  finishedAt?: number
  deviceId: string
  serverSeq: number
}

export type DoseStatus = 'administered' | 'omitted'
export interface DoseRevision {
  status: DoseStatus
  administeredAt?: number
  recordedAt: number
  deviceId: string
}

export interface DoseRecord {
  id: UUID
  treatmentId: UUID
  babyId: UUID
  scheduledAt: number
  status: DoseStatus
  administeredAt?: number
  notes?: string
  recordedAt: number
  deviceId: string
  serverSeq: number
  revision: number
  revisions?: DoseRevision[]
}

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled'
export interface MedicalAppointment {
  id: UUID
  babyId: UUID
  title: string
  place?: string
  startsAt: number
  durationMinutes?: number
  notes?: string
  status: AppointmentStatus
  createdAt: number
  updatedAt: number
  deviceId: string
  serverSeq: number
}

const doseRevisionKey = (revision: DoseRevision): string => JSON.stringify([
  revision.status,
  revision.administeredAt ?? null,
  revision.recordedAt,
  revision.deviceId,
])

const doseSnapshot = (dose: DoseRecord): DoseRevision => ({
  status: dose.status,
  ...(dose.administeredAt !== undefined ? { administeredAt: dose.administeredAt } : {}),
  recordedAt: dose.recordedAt,
  deviceId: dose.deviceId,
})

/**
 * Merge concurrent edits without discarding either device's audit history.
 * Equal revisions are resolved deterministically by timestamp and device ID.
 */
export const mergeDoseRecords = (left: DoseRecord, right: DoseRecord): DoseRecord => {
  const compare = (a: DoseRecord, b: DoseRecord): number =>
    a.revision - b.revision ||
    a.recordedAt - b.recordedAt ||
    a.deviceId.localeCompare(b.deviceId)
  const winner = compare(left, right) >= 0 ? left : right
  const history = new Map<string, DoseRevision>()
  for (const revision of [
    ...(left.revisions ?? []),
    doseSnapshot(left),
    ...(right.revisions ?? []),
    doseSnapshot(right),
  ]) {
    history.set(doseRevisionKey(revision), revision)
  }
  history.delete(doseRevisionKey(doseSnapshot(winner)))
  return {
    ...winner,
    serverSeq: Math.max(left.serverSeq, right.serverSeq),
    revisions: [...history.values()].sort((a, b) =>
      a.recordedAt - b.recordedAt ||
      a.deviceId.localeCompare(b.deviceId) ||
      a.status.localeCompare(b.status)
    ),
  }
}

const HOUR = 60 * 60 * 1000

const dateParts = (date: Date, formatter: Intl.DateTimeFormat): Record<string, number> => {
  const parts = formatter.formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]))
}

/** Resolve a wall-clock time in an IANA zone. Non-existent DST times are skipped. */
export const zonedTimeToEpoch = (
  year: number, month: number, day: number, hour: number, minute: number,
  timeZone = 'Europe/Madrid'
): number | null => {
  const target = Date.UTC(year, month - 1, day, hour, minute)
  const matches: number[] = []
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
  // A local time can map to zero, one, or two instants around DST changes.
  for (let candidate = target - 14 * HOUR; candidate <= target + 14 * HOUR; candidate += 60_000) {
    const p = dateParts(new Date(candidate), formatter)
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) matches.push(candidate)
  }
  return matches.length === 0 ? null : Math.min(...matches)
}

const addCalendarDays = (date: Date, days: number): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))

/** Generate scheduled instants in (after, through], preserving the treatment's original anchor. */
export const getUpcomingDoseTimes = (
  treatment: Treatment, after: number, through: number, timeZone = 'Europe/Madrid',
  doseRecords: readonly DoseRecord[] = []
): number[] => {
  if (treatment.status !== 'active' || through <= after) return []
  const end = Math.min(through, treatment.endsAt ?? Number.POSITIVE_INFINITY)
  if (end < treatment.startsAt) return []
  if (treatment.schedule.kind === 'interval') {
    const hours = treatment.schedule.everyHours
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) return []
    const step = hours * HOUR
    const lastAdministered = doseRecords
      .filter((dose) => dose.treatmentId === treatment.id && dose.status === 'administered')
      .reduce<number | null>((latest, dose) => {
        const administeredAt = dose.administeredAt ?? dose.scheduledAt
        return latest === null || administeredAt > latest ? administeredAt : latest
      }, null)
    const anchor = lastAdministered ?? treatment.startsAt
    // Once a dose has actually been administered, every following interval is
    // measured from that real administration time. An omitted dose never moves
    // the anchor. Before the first administration, startsAt remains the initial slot.
    const firstIndex = lastAdministered === null
      ? Math.max(0, Math.floor((after - anchor) / step) + 1)
      : Math.max(1, Math.floor((after - anchor) / step) + 1)
    const lastIndex = Math.floor((end - anchor) / step)
    const result: number[] = []
    for (let i = firstIndex; i <= lastIndex; i++) result.push(anchor + i * step)
    return result
  }
  const times = [...new Set(treatment.schedule.times)]
    .filter((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)).sort()
  if (times.length === 0) return []
  const first = addCalendarDays(new Date(after), -1)
  const last = addCalendarDays(new Date(end), 1)
  const result: number[] = []
  for (let day = first; day <= last; day = addCalendarDays(day, 1)) {
    for (const time of times) {
      const [hour = 0, minute = 0] = time.split(':').map(Number)
      const instant = zonedTimeToEpoch(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, timeZone)
      if (instant !== null && instant >= treatment.startsAt && instant <= end && instant > after) result.push(instant)
    }
  }
  return [...new Set(result)].sort((a, b) => a - b)
}

/** Cron runs hourly: send only in [scheduledAt - 1h, scheduledAt], never late. */
export const isDoseReminderDue = (scheduledAt: number, now: number): boolean =>
  now >= scheduledAt - HOUR && now <= scheduledAt

export const isAppointmentReminderDue = (
  appointment: Pick<MedicalAppointment, 'status' | 'startsAt'>,
  now: number
): boolean => appointment.status === 'scheduled' &&
  now >= appointment.startsAt - 24 * HOUR &&
  now < appointment.startsAt - 23 * HOUR

/** Stable ID makes both household devices refer to the same planned dose. */
export const plannedDoseId = (treatmentId: UUID, scheduledAt: number): string =>
  `dose:${treatmentId}:${scheduledAt}`

export const isTreatmentFinished = (treatment: Treatment, now: number): boolean =>
  treatment.status === 'finished' || (treatment.endsAt !== undefined && now > treatment.endsAt)
