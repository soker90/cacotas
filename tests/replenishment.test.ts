import { describe, expect, it } from 'vitest'
import { getReplenishmentAlerts } from '../src/lib/replenishment.ts'

describe('replenishment alerts', () => {
  it('alerts when the active location reaches its reorder point', () => {
    expect(
      getReplenishmentAlerts({
        stock: 10,
        reorderPoint: 10,
        daysRemaining: 20,
        warningDays: 7,
      })
    ).toEqual({ lowStock: true, runningOutSoon: false })
  })

  it('does not use global consumption to decide low stock', () => {
    expect(
      getReplenishmentAlerts({
        stock: 11,
        reorderPoint: 10,
        daysRemaining: 2,
        warningDays: 7,
      })
    ).toEqual({ lowStock: false, runningOutSoon: true })
  })

  it('alerts when the forecast reaches the warning window', () => {
    expect(
      getReplenishmentAlerts({
        stock: 40,
        reorderPoint: 10,
        daysRemaining: 7,
        warningDays: 7,
      })
    ).toEqual({ lowStock: false, runningOutSoon: true })
  })

  it('can show both alerts at the same time', () => {
    expect(
      getReplenishmentAlerts({
        stock: 5,
        reorderPoint: 10,
        daysRemaining: 3,
        warningDays: 7,
      })
    ).toEqual({ lowStock: true, runningOutSoon: true })
  })

  it('does not show the forecast alert without a forecast', () => {
    expect(
      getReplenishmentAlerts({
        stock: 5,
        reorderPoint: 10,
        daysRemaining: null,
        warningDays: 7,
      })
    ).toEqual({ lowStock: true, runningOutSoon: false })
  })
})
