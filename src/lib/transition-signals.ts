import type { TransitionSignals, UUID } from '../../shared/types.ts'

/**
 * Manual size-transition signals (SPEC.md §8). They live per
 * (babyId, sizeId) in localStorage and are never synced (§17).
 */

const KEY_PREFIX = 'cacotas.signals'

const key = (babyId: UUID, sizeId: number): string =>
  `${KEY_PREFIX}.${babyId}.${sizeId}`

const EMPTY: TransitionSignals = {
  leaks: false,
  tight: false,
  marks: false,
  hardToClose: false,
}

export const readSignals = (
  babyId: UUID,
  sizeId: number
): TransitionSignals => {
  try {
    const raw = localStorage.getItem(key(babyId, sizeId))
    if (raw === null) return EMPTY
    return { ...EMPTY, ...(JSON.parse(raw) as TransitionSignals) }
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
