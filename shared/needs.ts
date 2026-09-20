export interface PurchaseNeedsInput {
  currentStock: number
  nextStock: number
  currentDailyConsumption: number | null
  nextDailyConsumption: number | null
  transitionDays: number | null
  horizonDays: number
}

export interface PurchaseNeeds {
  current: number
  next: number
  total: number
  currentDays: number
  nextDays: number
}

/**
 * Estimate how many individual diapers are missing to cover the configured
 * planning horizon, taking a projected size change into account.
 *
 * Consumption is global for the baby; stock is local to the active location.
 * The transition estimate is intentionally used as a planning signal, not as
 * a claim that the size must change on that exact day.
 */
export const estimatePurchaseNeeds = ({
  currentStock,
  nextStock,
  currentDailyConsumption,
  nextDailyConsumption,
  transitionDays,
  horizonDays,
}: PurchaseNeedsInput): PurchaseNeeds | null => {
  if (
    currentDailyConsumption === null ||
    !Number.isFinite(currentDailyConsumption) ||
    horizonDays <= 0
  ) {
    return null
  }

  const currentDays =
    transitionDays === null
      ? horizonDays
      : Math.min(horizonDays, Math.max(0, transitionDays))
  const nextDays = horizonDays - currentDays

  const currentDemand = currentDailyConsumption * currentDays
  const nextDemand =
    nextDailyConsumption !== null && Number.isFinite(nextDailyConsumption)
      ? nextDailyConsumption * nextDays
      : 0

  const current = Math.max(0, Math.ceil(currentDemand - currentStock))
  const next =
    nextDays > 0 && nextDailyConsumption !== null && Number.isFinite(nextDailyConsumption)
      ? Math.max(0, Math.ceil(nextDemand - nextStock))
      : 0

  return {
    current,
    next,
    total: current + next,
    currentDays,
    nextDays,
  }
}
