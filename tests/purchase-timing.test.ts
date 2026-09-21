import { describe, expect, it } from 'vitest'
import { getPurchaseTiming } from '../shared/purchase-timing.ts'

describe('purchase timing', () => {
  const defaults = {
    warningDays: 7,
    watchDays: 14,
  }

  it('waits when there is plenty of stock', () => {
    expect(getPurchaseTiming({ ...defaults, daysRemaining: 21, transitionDays: 40 })?.status).toBe('WAIT')
  })

  it('starts watching for an offer inside the watch window', () => {
    expect(getPurchaseTiming({ ...defaults, daysRemaining: 14, transitionDays: 40 })?.status).toBe('WATCH_OFFER')
    expect(getPurchaseTiming({ ...defaults, daysRemaining: 10, transitionDays: 40 })?.status).toBe('WATCH_OFFER')
  })

  it('recommends buying now inside the warning window', () => {
    expect(getPurchaseTiming({ ...defaults, daysRemaining: 7, transitionDays: 40 })?.status).toBe('BUY_NOW')
    expect(getPurchaseTiming({ ...defaults, daysRemaining: 3, transitionDays: 40 })?.status).toBe('BUY_NOW')
  })

  it('does not recommend accumulating the current size when the transition comes first', () => {
    const result = getPurchaseTiming({ ...defaults, daysRemaining: 20, transitionDays: 8 })
    expect(result?.status).toBe('WAIT')
    expect(result?.transitionBeforeStockRunsOut).toBe(true)
  })

  it('still recommends buying when stock runs out before the transition', () => {
    const result = getPurchaseTiming({ ...defaults, daysRemaining: 6, transitionDays: 20 })
    expect(result?.status).toBe('BUY_NOW')
    expect(result?.transitionBeforeStockRunsOut).toBe(false)
  })

  it('waits when the transition happens exactly as stock runs out', () => {
    const result = getPurchaseTiming({ ...defaults, daysRemaining: 12, transitionDays: 12 })
    expect(result?.status).toBe('WAIT')
    expect(result?.transitionBeforeStockRunsOut).toBe(true)
  })

  it('returns null without a usable forecast', () => {
    expect(getPurchaseTiming({ ...defaults, daysRemaining: null, transitionDays: null })).toBeNull()
  })
})
