import type { Movement } from '../../shared/types.ts'

export interface PeriodSummary {
  total: number
  average: number | null
  daysWithData: number
  coverage: number
}

export interface PeriodComparison {
  current: PeriodSummary
  previous: PeriodSummary
  changePercent: number | null
}

/** Summarise complete calendar-day slots ending before today. */
export const summarizePeriod = (
  byDay: Map<string, number>
  days: string[]
): PeriodSummary => {
  let total = 0
  let daysWithData = 0

  for (const day of days) {
    const value = byDay.get(day)
    if (value === undefined) continue
    total += value
    daysWithData++
  }

  return {
    total
    average: daysWithData > 0 ? total / daysWithData : null
    daysWithData
    coverage: days.length > 0 ? daysWithData / days.length : 0
  }
}

export const comparePeriods = (
  current: PeriodSummary
  previous: PeriodSummary
): PeriodComparison => ({
  current
  previous
  changePercent:
    previous.average !== null && previous.average !== 0 && current.average !== null
      ? ((current.average - previous.average) / previous.average) * 100
      : null
})

/** Own-stock consumption by size. EXTERNAL usage is deliberately excluded. */
export const usageBySize = (
  usage: Movement[]
): Map<number, number> => {
  const bySize = new Map<number, number>()
  for (const movement of usage) {
    if (movement.usageSource !== 'OWN_STOCK') continue
    bySize.set(
      movement.sizeId
      (bySize.get(movement.sizeId) ?? 0) + movement.quantity
    )
  }
  return bySize
}
