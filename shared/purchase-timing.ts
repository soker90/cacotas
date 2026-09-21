import type { Confidence } from './forecast.ts'

export type PurchaseTimingStatus = 'WAIT' | 'WATCH_OFFER' | 'BUY_NOW'

export interface PurchaseTimingInput {
  daysRemaining: number | null
  transitionDays: number | null
  warningDays: number
  watchDays: number
  confidence: Confidence
  seeded: boolean
}

export interface PurchaseTiming {
  status: PurchaseTimingStatus
  daysRemaining: number | null
  transitionDays: number | null
  transitionBeforeStockRunsOut: boolean
  confidenceLimited: boolean
  seeded: boolean
}

/**
 * Decides whether the user can wait for an offer, should start looking, or
 * should buy now. Consumption is supplied by the global forecast; stock is
 * already scoped to the active location by the caller.
 *
 * A LOW-confidence forecast can make a BUY_NOW threshold look more certain
 * than the data supports. In that case the plan is capped at WATCH_OFFER
 * unless the stock is genuinely critical (half the warning window or less).
 * The cold-start estimate is always LOW and therefore follows the same rule.
 */
export const getPurchaseTiming = ({
  daysRemaining,
  transitionDays,
  warningDays,
  watchDays,
  confidence,
  seeded,
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
      confidenceLimited: false,
      seeded,
    }
  }

  const rawStatus: PurchaseTimingStatus =
    daysRemaining <= warningDays
      ? 'BUY_NOW'
      : daysRemaining <= watchDays
        ? 'WATCH_OFFER'
        : 'WAIT'

  // With little evidence, don't turn a forecast into a strong purchase
  // instruction. A truly critical stock position still wins.
  const criticalDays = Math.max(1, Math.floor(warningDays / 2))
  const confidenceLimited =
    confidence === 'LOW' &&
    rawStatus === 'BUY_NOW' &&
    daysRemaining > criticalDays
  const status = confidenceLimited ? 'WATCH_OFFER' : rawStatus

  return {
    status,
    daysRemaining,
    transitionDays,
    transitionBeforeStockRunsOut: false,
    confidenceLimited,
    seeded,
  }
}
