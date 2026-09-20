import { describe, expect, it } from 'vitest'
import { comparePeriods, summarizePeriod, usageBySize } from '../src/lib/statistics.ts'

describe('statistics helpers', () => {
  it('averages only days with data, not missing days as zero', () => {
    const summary = summarizePeriod(
      new Map([
        ['2026-09-01', 6],
        ['2026-09-03', 8]
      ]),
      ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']
    )

    expect(summary.total).toBe(14)
    expect(summary.daysWithData).toBe(2)
    expect(summary.coverage).toBe(0.5)
    expect(summary.average).toBe(7)
  })

  it('compares the current average with the previous period', () => {
    const current = summarizePeriod(
      new Map([['2026-09-03', 8], ['2026-09-04', 10]]),
      ['2026-09-03', '2026-09-04']
    )
    const previous = summarizePeriod(
      new Map([['2026-09-01', 5], ['2026-09-02', 5]]),
      ['2026-09-01', '2026-09-02']
    )

    expect(comparePeriods(current, previous).changePercent).toBe(80)
  })

  it('does not invent a comparison without a previous average', () => {
    const current = summarizePeriod(
      new Map([['2026-09-03', 8]]),
      ['2026-09-03']
    )
    const previous = summarizePeriod(new Map(), ['2026-09-02'])

    expect(comparePeriods(current, previous).changePercent).toBeNull()
  })

  it('groups only own-stock usage by diaper size', () => {
    const usage = [
      {
        id: 'u1',
        babyId: 'b1',
        type: 'USAGE',
        sizeId: 3,
        quantity: 4,
        delta: -4,
        usageSource: 'OWN_STOCK',
        occurredAt: 1,
        recordedAt: 1
      },
      {
        id: 'u2',
        babyId: 'b1',
        type: 'USAGE',
        sizeId: 3,
        quantity: 2,
        delta: 0,
        usageSource: 'EXTERNAL',
        occurredAt: 2,
        recordedAt: 2
      },
      {
        id: 'u3',
        babyId: 'b1',
        type: 'USAGE',
        sizeId: 4,
        quantity: 3,
        delta: -3,
        usageSource: 'OWN_STOCK',
        occurredAt: 3,
        recordedAt: 3
      }
    ] as never[]

    expect([...usageBySize(usage).entries()]).toEqual([[3, 4], [4, 3]])
  })
})
