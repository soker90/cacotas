export interface ReplenishmentAlertsInput {
  stock: number
  reorderPoint: number
  daysRemaining: number | null
  warningDays: number
}

export interface ReplenishmentAlerts {
  lowStock: boolean
  runningOutSoon: boolean
}

/**
 * Keeps the two replenishment signals independent:
 * - lowStock is a physical-stock threshold for one location
 * - runningOutSoon is a forecast based on the baby's global consumption
 */
export const getReplenishmentAlerts = ({
  stock,
  reorderPoint,
  daysRemaining,
  warningDays,
}: ReplenishmentAlertsInput): ReplenishmentAlerts => ({
  lowStock: stock <= reorderPoint,
  runningOutSoon:
    daysRemaining !== null &&
    Number.isFinite(daysRemaining) &&
    daysRemaining <= warningDays,
})
