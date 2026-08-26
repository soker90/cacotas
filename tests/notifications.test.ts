import { describe, expect, it } from 'vitest'
import {
  isPurchaseDay,
  shouldNotify,
  type LogEntry,
} from '../shared/notifications.ts'

const NOW = 1_800_000_000_000
const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  state_hash: 'abc',
  sent_at: NOW - 2 * 24 * 60 * 60 * 1000,
  snoozed_until: null,
  ...over,
})

describe('shouldNotify (§12 anti-spam)', () => {
  it('primera vez → enviar', () => {
    expect(shouldNotify(null, 'h1', NOW)).toEqual({
      send: true,
      reason: 'first-time'
    })
  })

  it('menos de 24 h desde el último envío → no enviar aunque cambie el estado', () => {
    const last = entry({ sent_at: NOW - 3 * 60 * 60 * 1000 })
    expect(shouldNotify(last, 'nuevo', NOW).reason).toBe('within-24h')
  })

  it('más de 24 h y estado sin cambios → no enviar', () => {
    const last = entry({ state_hash: 'mismo' })
    const d = shouldNotify(last, 'mismo', NOW)
    expect(d.send).toBe(false)
    expect(d.reason).toBe('unchanged')
  })

  it('más de 24 h y estado cambiado → enviar', () => {
    const last = entry({ state_hash: 'viejo' })
    expect(shouldNotify(last, 'nuevo', NOW)).toEqual({
      send: true,
      reason: 'state-changed'
    })
  })

  it('"me encargo yo" silencia hasta snoozed_until', () => {
    const last = entry({
      snoozed_until: NOW + 12 * 60 * 60 * 1000,
      sent_at: NOW - 30 * 60 * 60 * 1000
    })
    expect(shouldNotify(last, 'nuevo', NOW).reason).toBe('snoozed')
  })

  it('pasado el snooze vuelve a avisar', () => {
    const last = entry({ snoozed_until: NOW - 1000 })
    expect(shouldNotify(last, 'nuevo', NOW).send).toBe(true)
  })
})

describe('isPurchaseDay (anclaje al fin de semana)', () => {
  it('lunes a miércoles no son días de compra', () => {
    expect(isPurchaseDay(1)).toBe(false)
    expect(isPurchaseDay(2)).toBe(false)
    expect(isPurchaseDay(3)).toBe(false)
  })

  it('jueves a domingo sí', () => {
    for (const day of [4, 5, 6, 0]) expect(isPurchaseDay(day)).toBe(true)
  })
})
