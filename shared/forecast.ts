import type { DiaperSize, Movement } from './types.ts'
import { daysBetween, logicalDate } from './time.ts'

/**
 * Forecast engine (SPEC.md §7). Pure: no database, no network, no React.
 * Shared between client and Worker — same file, same tests.
 */

export interface ForecastInput {
  stock: number
  /** Live usage of ALL sizes (D-12), already filtered for undone movements. */
  usage: Movement[]
  now: number
  /** Size-transition estimate from shared/transition.ts (§8). */
  transition: TransitionEstimate | null
  /** The size being forecast — seeds the cold start (§7.2). */
  currentSize: DiaperSize | null
  warningDays: number // 7
  coverageDays: number // 21
  diapersPerPackage?: number
}

export type Confidence = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * Estimate of when the size will run small, produced by §8. Never
 * `confidence: NONE`: without data the estimator returns null instead.
 */
export interface TransitionEstimate {
  /** Days until the change (pessimistic: §8.9 uses the range's max). */
  days: number
  confidence: Confidence
  /**
   * Honest ±1σ range when the weight estimator produces the minimum (§8.9):
   * the UI shows "entre X y Y semanas", never a point figure (D-25).
   */
  range?: { min: number, mid: number, max: number }
}

export type ForecastStatus =
  | 'NO_DATA'
  | 'OK'
  | 'BUY_NOW'
  | 'BUY_BOTH_SIZES'
  | 'HOLD_SIZE_CHANGE'

export interface Forecast {
  dailyConsumption: number | null
  daysRemaining: number | null
  exhaustionDate: string | null
  confidence: Confidence
  variabilityHigh: boolean
  /** Days with registration actually used. */
  daysCovered: number
  /** True when the daily figure is the manufacturer seed (§7.2.1). */
  seeded: boolean
  status: ForecastStatus
  recommendedDiapers: number | null
  recommendedPackages: number | null
  /**
   * Passthrough of the input (SPEC.md §8). Non-null means a size change is
   * projected. Drives the app-only `SIZE_CHANGE_APPROACHING` notice (never
   * a push, SPEC.md §12) and the §8.7 prompt for the cases where it does
   * not already change `status`.
   */
  transition: TransitionEstimate | null
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const high = sorted.at(mid)
  const low = sorted.at(-(mid + 1))
  if (high === undefined || low === undefined) return NaN
  return sorted.length % 2 === 0 ? (low + high) / 2 : high
}

const mean = (values: number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length

/** Population standard deviation. */
const stdev = (values: number[]): number => {
  const m = mean(values)
  return Math.sqrt(
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length
  )
}

/** Usage grouped by logical day (D-08). External diapers excluded (D-05).
 *  Exported for the stats screen — calculated, never stored. */
export const usageByDay = (
  usage: Movement[]
): Map<string, number> => {
  const byDay = new Map<string, number>()
  for (const m of usage) {
    if (m.usageSource !== 'OWN_STOCK') continue // D-05
    const day = logicalDate(m.occurredAt)
    byDay.set(day, (byDay.get(day) ?? 0) + m.quantity)
  }
  return byDay
}

const confidenceFor = (
  daysCovered: number,
  coverage: number,
  variabilityHigh: boolean
): Confidence => {
  if (daysCovered === 0) return 'NONE'
  let level = 1 // LOW
  if (daysCovered >= 3) level = 2 // MEDIUM
  if (daysCovered >= 14) level = 3 // HIGH
  if (variabilityHigh) level -= 1
  if (coverage < 0.6) level -= 1
  return level < 1 ? 'LOW' : level === 1 ? 'LOW' : level === 2 ? 'MEDIUM' : 'HIGH'
}

export const computeForecast = (input: ForecastInput): Forecast => {
  const {
    stock,
    usage,
    now,
    transition,
    currentSize,
    warningDays,
    coverageDays,
    diapersPerPackage,
  } = input

  const byDay = usageByDay(usage)

  // The current day is excluded (D-13): at 10:00 you carry 2 and it would
  // sink the average.
  byDay.delete(logicalDate(now))

  // Days without registration are simply not in the map — absent data,
  // never zeros (D-13).
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
  const counts = days.map(([, n]) => n)
  const daysCovered = counts.length

  // ── Cold start (§7.2.1): with NO day of registration, seed with the
  // manufacturer average for the current size. A published, labelled
  // figure — not an invented one (D-13). Seeding only happens at zero
  // days: one real day already replaces the seed.
  if (daysCovered === 0) {
    const seed = currentSize?.dailyDiapers
    if (!seed) {
      return {
        dailyConsumption: null,
        daysRemaining: null,
        exhaustionDate: null,
        confidence: 'NONE',
        variabilityHigh: false,
        daysCovered: 0,
        seeded: false,
        status: 'NO_DATA',
        recommendedDiapers: null,
        recommendedPackages: null,
        transition,
      }
    }

    const seededDaysRemaining = Math.floor(stock / seed)
    const seededLowStock = stock <= seed * warningDays
    // §7.5: the seeded forecast is LOW and NEVER holds a purchase — the
    // seeded canHold clause is what closes that path for good (§7.2.1).
    const seededTransitionFirst =
      transition !== null && transition.days < seededDaysRemaining
    let seededStatus: ForecastStatus = 'OK'
    if (seededLowStock && seededTransitionFirst) seededStatus = 'BUY_BOTH_SIZES'
    else if (seededLowStock) seededStatus = 'BUY_NOW'

    const seededRecommended = Math.max(0, Math.ceil(seed * coverageDays) - stock)
    return {
      dailyConsumption: seed,
      daysRemaining: seededDaysRemaining,
      exhaustionDate: logicalDate(now + seededDaysRemaining * 86_400_000),
      // §7.2.1: LOW always, with or without adjustments — it never rises
      confidence: 'LOW',
      variabilityHigh: false,
      daysCovered: 0,
      seeded: true,
      status: seededStatus,
      recommendedDiapers: seededRecommended,
      recommendedPackages:
        diapersPerPackage !== undefined
          ? Math.ceil(seededRecommended / diapersPerPackage)
          : null,
      transition,
    }
  }

  // Estimator: median mix reacts to trends, robust to outliers (D-22),
  // and admits exactly one interpretation.
  const last3 = counts.slice(-3)
  const last7 = counts.slice(-7)
  let daily: number
  if (daysCovered >= 7) daily = 0.4 * median(last3) + 0.6 * median(last7)
  else if (daysCovered >= 3) daily = median(counts)
  else daily = mean(counts)

  // Coverage: how many calendar days of the period have data
  const firstDay = days.at(0)?.[0]
  const lastDay = days.at(-1)?.[0]
  if (firstDay === undefined || lastDay === undefined) {
    return {
      dailyConsumption: null,
      daysRemaining: null,
      exhaustionDate: null,
      confidence: 'NONE',
      variabilityHigh: false,
      daysCovered: 0,
      seeded: false,
      status: 'NO_DATA',
      recommendedDiapers: null,
      recommendedPackages: null,
      transition,
    }
  }
  const span = daysBetween(firstDay, lastDay) + 1
  const coverage = daysCovered / span

  const variabilityHigh =
    last7.length >= 3 && stdev(last7) / median(last7) > 0.4

  const confidence = confidenceFor(daysCovered, coverage, variabilityHigh)

  const daysRemaining = Math.floor(stock / daily)
  const exhaustionDate = logicalDate(
    now + daysRemaining * 86_400_000
  )

  const lowStock = stock <= daily * warningDays
  const transitionFirst =
    transition !== null && transition.days < daysRemaining

  // §7.5 / §8.6: the hold requires transition confidence MEDIUM or higher.
  // The population average (LOW) warns, but never blocks. The seeded
  // forecast (§7.2.1) is LOW anyway, and the `!seeded` clause closes the
  // path explicitly: the manufacturer estimate never holds a purchase.
  // (Seeding only happens in the cold-start branch above, which returned
  // already — here the forecast is never seeded.)
  const seeded = false
  const canHold =
    !seeded &&
    transition !== null &&
    (transition.confidence === 'MEDIUM' || transition.confidence === 'HIGH')

  // D-15: the hold NEVER applies when stock is already low
  let status: ForecastStatus = 'OK'
  if (lowStock && transitionFirst) status = 'BUY_BOTH_SIZES'
  else if (lowStock) status = 'BUY_NOW'
  else if (transitionFirst && canHold) status = 'HOLD_SIZE_CHANGE'

  const recommendedDiapers = Math.max(
    0,
    Math.ceil(daily * coverageDays) - stock
  )
  const recommendedPackages =
    diapersPerPackage !== undefined
      ? Math.ceil(recommendedDiapers / diapersPerPackage)
      : null

  return {
    dailyConsumption: daily,
    daysRemaining,
    exhaustionDate,
    confidence,
    variabilityHigh,
    daysCovered,
    seeded: false,
    status,
    recommendedDiapers,
    recommendedPackages,
    transition,
  }
}
