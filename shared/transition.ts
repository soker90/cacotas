import type { TransitionSignals } from './types.ts'

/**
 * Size-transition horizon from manual observation signals (SPEC.md §8).
 * The user decides the actual change (D-06); this only estimates when.
 */
export const transitionDays = (
  signals: TransitionSignals
): number | null => {
  const count = Object.values(signals).filter(Boolean).length
  if (count === 0) return null // no signals, no prediction, no hold
  if (count === 1) return 21 // APPROACHING
  return 7 // LIKELY_SOON (2 or more signals)
}
