import type { Movement, UUID } from '../../shared/types.ts'
import { daysBetween, logicalDate } from '../../shared/time.ts'
import type { CacotasDB } from './index.ts'

/** Stock per size = sum of deltas. */
export const stockBySize = async (
  database: CacotasDB,
  babyId: UUID
): Promise<Map<number, number>> => {
  const movs = await database.movements.where('babyId').equals(babyId).toArray()
  const out = new Map<number, number>()
  for (const m of movs) {
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
  from: number
): Promise<Movement[]> => {
  const all = await database.movements.where('babyId').equals(babyId).toArray()
  const undone = new Set(
    all.filter((m) => m.type === 'UNDO').map((m) => m.undoesMovementId ?? '')
  )
  return all.filter(
    (m) =>
      m.type === 'USAGE' && m.occurredAt >= from && !undone.has(m.id)
  )
}
