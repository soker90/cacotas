import type { Confidence, TransitionEstimate } from './forecast.ts'
import { daysBetween, logicalDate } from './time.ts'
import type { Baby, DiaperSize, TransitionSignals, WeightRecord } from './types.ts'

/**
 * Size-transition estimators (SPEC.md §8). Pure: no database, no network,
 * no React. Shared between client and Worker.
 *
 * The user changes the size by hand (D-06); this module only ESTIMATES when
 * the next change will come. Three independent estimators, combined by the
 * minimum — any of them can only mean "sooner than you thought". Each one
 * degrades to null when it lacks data, and the model keeps working with the
 * rest.
 *
 * This is a product heuristic, NOT medical advice. The app never presents a
 * weight as "recommended" nor judges whether the baby's growth is adequate.
 */

// ── Seed data — Dodot size table (§8.2) ─────────────────────────────────
// Manufacturer ranges and averages, editable by the user (§4.4). Never
// presented as a medical recommendation.

export const DODOT_SIZES: DiaperSize[] = [
  { id: 0, name: 'Talla 0', minWeightKg: 1.5, maxWeightKg: 2.5, dailyDiapers: 10, typicalMonths: 1.6 },
  { id: 1, name: 'Talla 1', minWeightKg: 2.0, maxWeightKg: 5.0, dailyDiapers: 9, typicalMonths: 1.7 },
  { id: 2, name: 'Talla 2', minWeightKg: 4.0, maxWeightKg: 8.0, dailyDiapers: 8, typicalMonths: 2.8 },
  { id: 3, name: 'Talla 3', minWeightKg: 6.0, maxWeightKg: 10.0, dailyDiapers: 7, typicalMonths: 5.8 },
  { id: 4, name: 'Talla 4', minWeightKg: 9.0, maxWeightKg: 15.0, dailyDiapers: 7, typicalMonths: 6.8 },
  { id: 5, name: 'Talla 5', minWeightKg: 11.0, maxWeightKg: 17.0, dailyDiapers: 6, typicalMonths: 5.0 },
  { id: 6, name: 'Talla 6', minWeightKg: 13.0, dailyDiapers: 6, typicalMonths: 5.8 },
  { id: 7, name: 'Talla 7', minWeightKg: 17.0, dailyDiapers: 6, typicalMonths: 4.1 },
]

// ── Signals (§8.3) ───────────────────────────────────────────────────────

/**
 * One signal already justifies raising the next size (MEDIUM): a red mark
 * is not a prediction, it is irritated skin now. Two or more (HIGH) mean
 * change now. Leaks do not score (§8.3): they can mean a too-small OR a
 * too-big diaper.
 */
export const signalDays = (
  signals: TransitionSignals
): TransitionEstimate | null => {
  const n = Object.values(signals).filter(Boolean).length
  if (n === 0) return null
  if (n === 1) return { days: 3, confidence: 'MEDIUM' }
  return { days: 0, confidence: 'HIGH' } // two or more: change now
}

// ── Time in size (§8.4) ──────────────────────────────────────────────────

/**
 * The most valuable estimator from day 1: it needs only the occurredAt of
 * the last SIZE_CHANGE, already in the ledger. Always LOW confidence: it is
 * a population average and individual variation is large (§8.6).
 */
export const durationDays = (input: {
  sizeStartedAt: number
  size: DiaperSize
  now: number
}): TransitionEstimate | null => {
  if (!input.size.typicalMonths) return null
  const elapsed = (input.now - input.sizeStartedAt) / 86_400_000
  const expected = input.size.typicalMonths * 30.44
  return {
    days: Math.max(0, Math.floor(expected - elapsed)),
    confidence: 'LOW',
  }
}

// ── Weight estimator (§8.5) ──────────────────────────────────────────────

/** Population weekly gain (WHO tables). */
const WEEKLY_GAIN_G = [
  { untilWeeks: 6, grams: 175 }, // 0-6 w    (range 140-250)
  { untilWeeks: 17, grams: 150 }, // 6 w-4 m (range 100-200)
  { untilWeeks: 26, grams: 115 }, // 4-6 m   (range  80-150)
  { untilWeeks: 52, grams: 60 }, // 6-12 m   (range  40- 80)
  { untilWeeks: 999, grams: 40 },
] as const

export const weeklyGainG = (ageWeeks: number): number =>
  WEEKLY_GAIN_G.find((r) => ageWeeks < r.untilWeeks)!.grams

export const SEX_FACTOR: Record<'male' | 'female' | 'unknown', number> = {
  male: 1.05,
  female: 0.95,
  unknown: 1.0,
}

/** Weekly weight-gain standard deviation behind the honest range (§8.9). */
export const SD_GAIN_G = 50

export type BabyGrowth = Pick<Baby, 'birthDate' | 'sex' | 'gestationalWeeks'>

/** Age in weeks over logical dates (§5): DST-safe, never raw milliseconds. */
export const weeksSince = (birthDate: string, now: number): number =>
  daysBetween(birthDate, logicalDate(now)) / 7

/** Weeks between two instants, also over logical dates. */
export const weeksBetween = (from: number, to: number): number =>
  daysBetween(logicalDate(from), logicalDate(to)) / 7

/** Corrected age for premature babies: the whole growth table shifts (§8.8). */
export const correctedAgeWeeks = (input: {
  birthDate: string
  gestationalWeeks: number
  now: number
}): number => {
  const chrono = weeksSince(input.birthDate, input.now)
  return Math.max(0, chrono - (40 - input.gestationalWeeks))
}

/**
 * Target weight: midpoint of the overlap between the current and the next
 * size. Waiting for the current max arrives late; in practice the change
 * happens inside the common zone (§8.5).
 */
export const targetWeightKg = (
  current: DiaperSize,
  next: DiaperSize | null
): number | null => {
  if (!current.maxWeightKg) return null
  if (!next?.minWeightKg) return current.maxWeightKg
  return (next.minWeightKg + current.maxWeightKg) / 2
}

/** Real weekly gain between the last two weights, if reliable. */
export const observedGainG = (weights: WeightRecord[]): number | null => {
  if (weights.length < 2) return null
  const a = weights.at(-2)!
  const b = weights.at(-1)!
  const weeks = weeksBetween(a.recordedAt, b.recordedAt)
  if (weeks < 1) return null // short interval: scale noise
  const g = ((b.weightKg - a.weightKg) * 1000) / weeks
  if (g <= 0 || g > 400) return null // implausible: measurement error
  return g
}

/**
 * Best weekly-gain estimate (g): the baby's own observed rate if reliable;
 * otherwise the population table adjusted by sex.
 *
 * ⚠️ SEX_FACTOR is applied HERE and ONLY here (§8.5): neither the weight
 * projection nor the day calculation multiplies again — a double
 * application would give 175 × 1.05² instead of 175 × 1.05.
 */
const currentGainG = (input: {
  weights: WeightRecord[]
  baby: BabyGrowth
  now: number
}): { g: number, observed: boolean } => {
  const observed = observedGainG(input.weights)
  if (observed !== null) return { g: observed, observed: true }
  const ageWeeks = correctedAgeWeeks({
    birthDate: input.baby.birthDate!,
    gestationalWeeks: input.baby.gestationalWeeks ?? 40,
    now: input.now,
  })
  return {
    g: weeklyGainG(ageWeeks) * SEX_FACTOR[input.baby.sex ?? 'unknown'],
    observed: false,
  }
}

/**
 * Current weight estimate. null with corrected age < 2 weeks: the newborn
 * LOSES weight first (physiological descent) before recovering it, so
 * projecting there produces false results (§8.5).
 */
export const estimateWeightKg = (input: {
  weights: WeightRecord[] // sorted by recordedAt
  baby: BabyGrowth
  now: number
}): { kg: number, personal: boolean } | null => {
  if (!input.baby.birthDate) return null // no date, no age, no projection (§10)
  const last = input.weights.at(-1)
  if (!last) return null

  const ageWeeks = correctedAgeWeeks({
    birthDate: input.baby.birthDate,
    gestationalWeeks: input.baby.gestationalWeeks ?? 40,
    now: input.now,
  })
  if (ageWeeks < 2) return null

  const elapsed = weeksBetween(last.recordedAt, input.now)
  const { g: gain, observed } = currentGainG(input)
  return {
    kg: last.weightKg + (gain * elapsed) / 1000,
    personal: observed,
  }
}

/**
 * Honest range until the target weight (§8.9): ±1σ of weekly gain. `mid`
 * matches the point estimate; `min` assumes fast growth, `max` slow. The
 * decision to buy uses `max` — the pessimistic end (§8.6).
 */
export const weightDaysRange = (input: {
  weights: WeightRecord[] // sorted by recordedAt
  baby: BabyGrowth
  current: DiaperSize
  next: DiaperSize | null
  now: number
}): { min: number, mid: number, max: number, confidence: Confidence } | null => {
  const est = estimateWeightKg(input)
  const target = targetWeightKg(input.current, input.next)
  if (!est || target === null) return null

  const confidence: Confidence = est.personal ? 'MEDIUM' : 'LOW'
  if (est.kg >= target) return { min: 0, mid: 0, max: 0, confidence }

  // Same rate as estimateWeightKg (SEX_FACTOR applied exactly once)
  const { g: gain } = currentGainG(input)
  const need = target - est.kg // kg still to gain
  const fast = (gain + SD_GAIN_G) / 7000
  const slow = Math.max(gain - SD_GAIN_G, 1) / 7000
  return {
    min: Math.floor(need / fast),
    mid: Math.floor(need / (gain / 7000)),
    max: Math.floor(need / slow),
    confidence,
  }
}

// ── Combination (§8.1) ───────────────────────────────────────────────────

export interface TransitionInput {
  signals: TransitionSignals
  /** occurredAt of the last SIZE_CHANGE (current size). null if none. */
  sizeStartedAt: number | null
  currentSize: DiaperSize | null
  nextSize: DiaperSize | null
  /** Weight records sorted by recordedAt. */
  weights: WeightRecord[]
  baby: BabyGrowth
  now: number
}

/**
 * The three estimators combined by the minimum; the confidence is the
 * winner's. If two tie in days, the higher confidence wins — the result
 * must not depend on array order (§8.1). For the purchase decision the
 * weight estimator contributes its PESSIMISTIC end (`max`, §8.9).
 */
export const estimateTransition = (
  input: TransitionInput
): TransitionEstimate | null => {
  const candidates: TransitionEstimate[] = []
  let range: TransitionEstimate['range'] | undefined

  const signal = signalDays(input.signals)
  if (signal !== null) candidates.push(signal)

  if (input.sizeStartedAt !== null && input.currentSize !== null) {
    const duration = durationDays({
      sizeStartedAt: input.sizeStartedAt,
      size: input.currentSize,
      now: input.now,
    })
    if (duration !== null) candidates.push(duration)
  }

  if (input.currentSize !== null) {
    const weight = weightDaysRange({
      weights: input.weights,
      baby: input.baby,
      current: input.currentSize,
      next: input.nextSize,
      now: input.now,
    })
    if (weight !== null) {
      candidates.push({ days: weight.max, confidence: weight.confidence })
      range = { min: weight.min, mid: weight.mid, max: weight.max }
    }
  }

  if (candidates.length === 0) return null

  const min = Math.min(...candidates.map((c) => c.days))
  const winners = candidates.filter((c) => c.days === min)
  const weightWins = range !== undefined && candidates.at(-1)!.days === min
  const confidence: Confidence = winners.some((w) => w.confidence === 'HIGH')
    ? 'HIGH'
    : winners.some((w) => w.confidence === 'MEDIUM')
      ? 'MEDIUM'
      : 'LOW'

  return {
    days: min,
    confidence,
    ...(weightWins && range ? { range } : {}),
  }
}
