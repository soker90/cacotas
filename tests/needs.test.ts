import { describe, expect, it } from 'vitest'
import { estimatePurchaseNeeds } from '../shared/needs.ts'

describe('estimatePurchaseNeeds', () => {
  it('covers the horizon with the current size when there is no transition', () => {
    expect(
      estimatePurchaseNeeds({
        currentStock: 20,
        nextStock: 0,
        currentDailyConsumption: 7,
        nextDailyConsumption: 6,
        transitionDays: null,
        horizonDays: 21,
      })
    ).toEqual({
      current: 127,
      next: 0,
      total: 127,
      currentDays: 21,
      nextDays: 0,
    })
  })

  it('splits the horizon at the estimated size change', () => {
    expect(
      estimatePurchaseNeeds({
        currentStock: 20,
        nextStock: 10,
        currentDailyConsumption: 7,
        nextDailyConsumption: 6,
        transitionDays: 8,
        horizonDays: 21,
      })
    ).toEqual({
      current: 36,
      next: 68,
      total: 104,
      currentDays: 8,
      nextDays: 13,
    })
  })

  it('does not recommend buying stock that already covers the forecast', () => {
    expect(
      estimatePurchaseNeeds({
        currentStock: 100,
        nextStock: 100,
        currentDailyConsumption: 7,
        nextDailyConsumption: 6,
        transitionDays: 8,
        horizonDays: 21,
      })
    ).toEqual({
      current: 0,
      next: 0,
      total: 0,
      currentDays: 8,
      nextDays: 13,
    })
  })

  it('uses all of the horizon for an immediate transition', () => {
    expect(
      estimatePurchaseNeeds({
        currentStock: 0,
        nextStock: 10,
        currentDailyConsumption: 7,
        nextDailyConsumption: 6,
        transitionDays: 0,
        horizonDays: 21,
      })
    ).toEqual({
      current: 0,
      next: 116,
      total: 116,
      currentDays: 0,
      nextDays: 21,
    })
  })

  it('returns null without a usable current consumption estimate', () => {
    expect(
      estimatePurchaseNeeds({
        currentStock: 0,
        nextStock: 0,
        currentDailyConsumption: null,
        nextDailyConsumption: 6,
        transitionDays: 8,
        horizonDays: 21,
      })
    ).toBeNull()
  })

  it('negative stock increases the amount needed to recover coverage', () => {
    expect(
      estimatePurchaseNeeds({
        currentStock: -5,
        nextStock: 0,
        currentDailyConsumption: 7,
        nextDailyConsumption: null,
        transitionDays: null,
        horizonDays: 7,
      })
    ).toEqual({
      current: 54,
      next: 0,
      total: 54,
      currentDays: 7,
      nextDays: 0,
    })
  })
})
