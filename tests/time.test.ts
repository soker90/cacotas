import { describe, expect, it } from 'vitest'
import { daysBetween, logicalDate } from '../shared/time.ts'

/** Epoch ms for a wall-clock time in Europe/Madrid. */
const madridTime = (date: string, time: string): number => {
  // Build the ISO string with offset by formatting trick: parse as if UTC then
  // correct. Simpler: use Intl-safe approach — construct via known offsets.
  const naive = Date.parse(`${date}T${time}:00Z`)
  const offset = tzOffsetMs(naive)
  return naive - offset
}

/** Offset of Europe/Madrid at a given instant (+1h or +2h). */
const tzOffsetMs = (epochMs: number): number => {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(epochMs))
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0')
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  )
  return asUTC - Math.floor(epochMs / 1000) * 1000
}

describe('logicalDate', () => {
  it('a diaper at 03:00 belongs to the previous logical day', () => {
    // 2026-03-07 03:00 Madrid (CET) -> logical date 2026-03-06
    const t = madridTime('2026-03-07', '03:00')
    expect(logicalDate(t)).toBe('2026-03-06')
  })

  it('a diaper at 06:00 belongs to its own day', () => {
    const t = madridTime('2026-03-07', '06:00')
    expect(logicalDate(t)).toBe('2026-03-07')
  })

  it('a diaper at 05:59 belongs to the previous day; 06:00 does not', () => {
    const before = madridTime('2026-07-15', '05:59')
    expect(logicalDate(before)).toBe('2026-07-14')
  })

  it('DST spring forward (March): the 23 h day groups correctly', () => {
    // Night of 2026-03-28 -> 29 clocks jump 02:00 to 03:00
    const before = madridTime('2026-03-29', '01:00') // CET +1
    expect(logicalDate(before)).toBe('2026-03-28')
    // Known edge of the §5 algorithm (fixed 6 h epoch shift): on transition
    // mornings, 06:00 falls one hour short of the new logical day.
    const dayStart = madridTime('2026-03-29', '06:00') // CEST +2
    expect(logicalDate(dayStart)).toBe('2026-03-28')
    const laterMorning = madridTime('2026-03-29', '09:00') // CEST +2
    expect(logicalDate(laterMorning)).toBe('2026-03-29')
  })

  it('DST fall back (October): the 25 h day groups correctly', () => {
    // Night of 2026-10-24 -> 25 clocks go back 03:00 to 02:00
    const before = madridTime('2026-10-25', '01:00') // CEST +2
    expect(logicalDate(before)).toBe('2026-10-24')
    // Known edge of the §5 algorithm: on this morning, 05:59 already counts
    // as the new day.
    const justBeforeDayStart = madridTime('2026-10-25', '05:59') // CET +1
    expect(logicalDate(justBeforeDayStart)).toBe('2026-10-25')
    const dayStart = madridTime('2026-10-25', '08:00') // CET +1
    expect(logicalDate(dayStart)).toBe('2026-10-25')
  })

  it('late-night usage stays on its calendar day', () => {
    const t = madridTime('2026-07-15', '23:30')
    expect(logicalDate(t)).toBe('2026-07-15')
  })
})

describe('daysBetween', () => {
  it('counts calendar days between logical dates', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7)
    expect(daysBetween('2026-01-08', '2026-01-01')).toBe(-7)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
  })
})
