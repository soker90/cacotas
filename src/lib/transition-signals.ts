import type { TransitionSignals, UUID } from '../../shared/types.ts'

/**
 * Manual size-transition signals (SPEC.md §8.3). They live per
 * (babyId, sizeId) in localStorage and are never synced (§17).
 */

const KEY_PREFIX = 'cacotas.signals'

const key = (babyId: UUID, sizeId: number): string =>
  `${KEY_PREFIX}.${babyId}.${sizeId}`

const EMPTY: TransitionSignals = {
  tabsNotCentered: false,
  noTwoFingers: false,
  redMarks: false,
  uncoveredButtocks: false,
  frequentDermatitis: false,
  pullsDiaper: false,
}

/** Keys of the pre-#10 signal set — wiped on sight (decision: no mapping). */
const LEGACY_KEYS = ['leaks', 'tight', 'marks', 'hardToClose']

export const readSignals = (
  babyId: UUID,
  sizeId: number
): TransitionSignals => {
  const k = key(babyId, sizeId)
  try {
    const raw = localStorage.getItem(k)
    if (raw === null) return EMPTY
    const parsed = JSON.parse(raw) as Partial<TransitionSignals>
    if (LEGACY_KEYS.some((legacy) => legacy in parsed)) {
      localStorage.removeItem(k)
      return EMPTY
    }
    return { ...EMPTY, ...parsed }
  } catch {
    return EMPTY
  }
}

export const writeSignal = (
  babyId: UUID,
  sizeId: number,
  signal: keyof TransitionSignals,
  value: boolean
): void => {
  const current = readSignals(babyId, sizeId)
  localStorage.setItem(
    key(babyId, sizeId),
    JSON.stringify({ ...current, [signal]: value })
  )
}

/** Called on SIZE_CHANGE: the signals described the old size. */
export const clearSignals = (babyId: UUID, sizeId: number): void => {
  localStorage.removeItem(key(babyId, sizeId))
}
