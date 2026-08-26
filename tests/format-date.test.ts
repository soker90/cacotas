import { describe, expect, it } from 'vitest'
import { formatLogicalDateEs } from '../src/lib/format-date.ts'

describe('formatLogicalDateEs', () => {
  it('formats a logical date in Spanish (day + month, no year)', () => {
    expect(formatLogicalDateEs('2026-09-04')).toBe('4 de septiembre')
  })

  it('never does epoch arithmetic that could shift the day across DST', () => {
    // October 25th 2026 is the DST fallback night in Europe/Madrid.
    expect(formatLogicalDateEs('2026-10-25')).toBe('25 de octubre')
  })
})
