export type PurchaseTimingStatus = 'WAIT' | 'WATCH_OFFER' | 'BUY_NOW'

export interface PurchaseTimingInput {
  daysRemaining: number | null
  transitionDays: number | null
  warningDays: number
  watchDays: number
}

export interface PurchaseTiming {
  status: PurchaseTimingStatus
  daysRemaining: number | null
  transitionDays: number | null
  transitionBeforeStockRunsOut: boolean
}

/**
 * Decides whether the user can wait for an offer, should start looking, or
 * should buy now. Consumption is supplied by the global forecast; stock is
 * already scoped to the active location by the caller.
 */
export const getPurchaseTiming = ({
  daysRemaining,
  transitionDays,
  warningDays,
  watchDays,
}: PurchaseTimingInput): PurchaseTiming | null => {
  if (
    daysRemaining === null ||
    !Number.isFinite(daysRemaining) ||
    warningDays <= 0 ||
    watchDays < warningDays
  ) {
    return null
  }

  const transitionBeforeStockRunsOut =
    transitionDays !== null &&
    Number.isFinite(transitionDays) &&
    transitionDays <= daysRemaining

  if (transitionBeforeStockRunsOut) {
    return {
      status: 'WAIT',
      daysRemaining,
      transitionDays,
      transitionBeforeStockRunsOut: true,
    }
  }

  const status: PurchaseTimingStatus =
    daysRemaining <= warningDays
      ? 'BUY_NOW'
      : daysRemaining <= watchDays
        ? 'WATCH_OFFER'
        : 'WAIT'

  return {
    status,
    daysRemaining,
    transitionDays,
    transitionBeforeStockRunsOut: false,
  }
}
