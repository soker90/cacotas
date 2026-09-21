import { describe, expect, it } from 'vitest'
import { getPurchaseTiming } from '../shared/purchase-timing.ts'

describe('purchase timing', () => {
  const defaults = {
    warningDays: 7,
    watchDays: 14,
    confidence: 'HIGH' as const,
    seeded: false,
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

  it('caps a low-confidence BUY_NOW at WATCH_OFFER when stock is not critical', () => {
    const result = getPurchaseTiming({
      ...defaults,
      confidence: 'LOW',
      daysRemaining: 7,
      transitionDays: 40,
    })
    expect(result?.status).toBe('WATCH_OFFER')
    expect(result?.confidenceLimited).toBe(true)
  })

  it('keeps a low-confidence forecast conservative before the warning window', () => {
    const result = getPurchaseTiming({
      ...defaults,
      confidence: 'LOW',
      daysRemaining: 12,
      transitionDays: 40,
    })
    expect(result?.status).toBe('WATCH_OFFER')
    expect(result?.confidenceLimited).toBe(false)
  })

  it('still says BUY_NOW when low-confidence stock is genuinely critical', () => {
    const result = getPurchaseTiming({
      ...defaults,
      confidence: 'LOW',
      daysRemaining: 3,
      transitionDays: 40,
    })
    expect(result?.status).toBe('BUY_NOW')
    expect(result?.confidenceLimited).toBe(false)
  })

  it('treats the Dodot cold-start estimate as low confidence', () => {
    const result = getPurchaseTiming({
      ...defaults,
      confidence: 'LOW',
      seeded: true,
      daysRemaining: 7,
      transitionDays: 40,
    })
    expect(result?.status).toBe('WATCH_OFFER')
    expect(result?.seeded).toBe(true)
    expect(result?.confidenceLimited).toBe(true)
  })

  it('does not accumulate the current size when a low-confidence transition comes first', () => {
    const result = getPurchaseTiming({
      ...defaults,
      confidence: 'LOW',
      daysRemaining: 20,
      transitionDays: 8,
    })
    expect(result?.status).toBe('WAIT')
    expect(result?.transitionBeforeStockRunsOut).toBe(true)
  })

  it('returns null without a usable forecast', () => {
    expect(getPurchaseTiming({
      ...defaults,
      daysRemaining: null,
      transitionDays: null,
    })).toBeNull()
  })
})
