import { describe, expect, it } from 'vitest'
import { confidenceLabel, forecastCaveats } from '../src/lib/forecast-texts.ts'
import type { Forecast } from '../shared/forecast.ts'

const forecast = (overrides: Partial<Forecast> = {}): Forecast => ({
  dailyConsumption: 6.2,
  daysRemaining: 7,
  exhaustionDate: null,
  confidence: 'LOW',
  variabilityHigh: false,
  daysCovered: 1,
  seeded: false,
  status: 'OK',
  recommendedDiapers: 0,
  recommendedPackages: null,
  transition: null,
  ...overrides,
})

describe('forecast text', () => {
  it('shows the real history length when there is very little data', () => {
    expect(forecastCaveats(forecast({ daysCovered: 1 }))).toContain(
      'Histórico corto: basado en 1 día de consumo real.'
    )
    expect(forecastCaveats(forecast({ daysCovered: 2 }))).toContain(
      'Histórico corto: basado en 2 días de consumo real.'
    )
  })

  it('does not call a three-day history short', () => {
    expect(forecastCaveats(forecast({ daysCovered: 3 }))).not.toContain(
      'Histórico corto: basado en 3 días de consumo real.'
    )
  })

  it('keeps the Dodot label for a cold-start forecast', () => {
    const caveats = forecastCaveats(forecast({
      seeded: true,
      daysCovered: 0,
      dailyConsumption: 9,
    }))
    expect(caveats).toContain('Estimación de Dodot: ≈ 9 pañales al día.')
    expect(caveats.some((caveat) => caveat.startsWith('Histórico corto:'))).toBe(false)
  })

  it('labels low confidence as few data', () => {
    expect(confidenceLabel(forecast())).toBe('pocos datos')
  })
})
