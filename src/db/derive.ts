import type { Movement, UUID } from '../../shared/types.ts'
import { daysBetween, logicalDate } from '../../shared/time.ts'
import type { CacotasDB } from './index.ts'

/** Stock per size = sum of deltas. */
export const stockBySize = async (
  database: CacotasDB,
  babyId: UUID,
  locationId?: UUID
): Promise<Map<number, number>> => {
  const movs = await database.movements.where('babyId').equals(babyId).toArray()
  const out = new Map<number, number>()
  for (const m of movs) {
    if (locationId !== undefined && m.locationId !== locationId) continue
    out.set(m.sizeId, (out.get(m.sizeId) ?? 0) + m.delta)
  }
  return out
}

/** Current size = sizeId of the last SIZE_CHANGE by occurredAt. null if none. */
export const currentSize = async (
  database: CacotasDB,
  babyId: UUID
): Promise<number | null> => (await lastSizeChange(database, babyId))?.sizeId ?? null

/** The last SIZE_CHANGE event: current sizeId and when it started (§8.4). */
export const lastSizeChange = async (
  database: CacotasDB,
  babyId: UUID
): Promise<{ sizeId: number, occurredAt: number } | null> => {
  const changes = await database.movements
    .where('[babyId+type]')
    .equals([babyId, 'SIZE_CHANGE'])
    .sortBy('occurredAt')
  const last = changes.at(-1)
  return last === undefined ? null : { sizeId: last.sizeId, occurredAt: last.occurredAt }
}

/**
 * Real duration in logical days of each size, from the consecutive
 * SIZE_CHANGEs (§6, §14). The still-open size counts up to `now` with its
 * running total. Like currentSize, undone SIZE_CHANGE events still count
 * (D-02 — the ledger view is derived, never rewritten). A size used in two
 * separated periods sums both.
 */
export const sizeDurations = async (
  database: CacotasDB,
  babyId: UUID,
  now: number = Date.now()
): Promise<Map<number, number>> => {
  const changes = await database.movements
    .where('[babyId+type]')
    .equals([babyId, 'SIZE_CHANGE'])
    .sortBy('occurredAt')
  const out = new Map<number, number>()
  for (const [index, change] of changes.entries()) {
    const next = changes[index + 1]
    const end = next === undefined ? now : next.occurredAt
    const days = Math.max(0, daysBetween(logicalDate(change.occurredAt), logicalDate(end)))
    out.set(change.sizeId, (out.get(change.sizeId) ?? 0) + days)
  }
  return out
}

/**
 * Live (non-undone) usage movements since a given instant.
 * A movement is undone if an UNDO points at it via undoesMovementId.
 * Both remain in the database (D-02); they are only filtered here.
 */
export const liveUsage = async (
  database: CacotasDB,
  babyId: UUID,
  from: number,
  locationId?: UUID
): Promise<Movement[]> => {
  const all = await database.movements.where('babyId').equals(babyId).toArray()
  const undone = new Set(
    all.filter((m) => m.type === 'UNDO').map((m) => m.undoesMovementId ?? '')
  )
  return all.filter(
    (m) =>
      m.type === 'USAGE' && m.occurredAt >= from &&
      (locationId === undefined || m.locationId === locationId) &&
      !undone.has(m.id)
  )
}

const TRANSITION_SIGNAL_KEYS = [
  'tabsNotCentered',
  'noTwoFingers',
  'redMarks',
  'uncoveredButtocks',
  'frequentDermatitis',
  'pullsDiaper',
] as const

/** Active SIGNAL movements for a baby/size, ignoring SIGNALs cancelled by UNDO. */
const activeSignalMovements = async (
  database: CacotasDB,
  babyId: UUID,
  sizeId: number
): Promise<Movement[]> => {
  const all = await database.movements.where('babyId').equals(babyId).toArray()
  const undone = new Set(
    all
      .filter((m) => m.type === 'UNDO')
      .map((m) => m.undoesMovementId ?? '')
  )
  const sizeChange = await lastSizeChange(database, babyId)
  return all
    .filter(
      (m) =>
        m.type === 'SIGNAL' &&
        m.sizeId === sizeId &&
        m.note !== undefined &&
        (TRANSITION_SIGNAL_KEYS as readonly string[]).includes(m.note) &&
        !undone.has(m.id) &&
        (sizeChange === null || m.occurredAt >= sizeChange.occurredAt)
    )
    .sort((a, b) => a.occurredAt - b.occurredAt)
}

/** Active transition signal keys after the latest SIZE_CHANGE. */
export const activeSignals = async (
  database: CacotasDB,
  babyId: UUID,
  sizeId: number
): Promise<Set<string>> => {
  const movements = await activeSignalMovements(database, babyId, sizeId)
  return new Set(movements.map((movement) => movement.note as string))
}

/** Latest active SIGNAL for a key, used to append its UNDO. */
export const latestActiveSignal = async (
  database: CacotasDB,
  babyId: UUID,
  sizeId: number,
  signal: string
): Promise<Movement | null> => {
  const movements = await activeSignalMovements(database, babyId, sizeId)
  return movements.filter((movement) => movement.note === signal).at(-1) ?? null
}

/** True while the latest non-undone SNOOZE is less than 14 days old. */
export const snoozeActive = async (
  database: CacotasDB,
  babyId: UUID,
  now: number = Date.now()
): Promise<boolean> => {
  const all = await database.movements.where('babyId').equals(babyId).toArray()
  const undone = new Set(
    all
      .filter((m) => m.type === 'UNDO')
      .map((m) => m.undoesMovementId ?? '')
  )
  const latest = all
    .filter((m) => m.type === 'SNOOZE' && !undone.has(m.id))
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .at(-1)
  return latest !== undefined && now - latest.occurredAt < 14 * 86_400_000
}
