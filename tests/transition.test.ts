import { describe, expect, it } from 'vitest'
import {
  DODOT_SIZES,
  correctedAgeWeeks,
  durationDays,
  estimateTransition,
  estimateWeightKg,
  observedGainG,
  signalDays,
  targetWeightKg,
  weeklyGainG,
  weeksBetween,
  weightDaysRange,
} from '../shared/transition.ts'
import { computeForecast } from '../shared/forecast.ts'
import type { Baby, DiaperSize, TransitionSignals, WeightRecord } from '../shared/types.ts'

// January: no DST in Europe/Madrid — UTC noon is a safe mid-day instant.
const NOW = Date.UTC(2026, 0, 20, 12, 0, 0)
const daysAgo = (n: number): number => NOW - n * 86_400_000

const BABY_ID = 'baby-t'
let counter = 0
const mkWeight = (kg: number, recordedAt: number): WeightRecord => ({
  id: `w-${(counter++).toString()}`,
  babyId: BABY_ID,
  weightKg: kg,
  recordedAt,
  deviceId: 'device-test',
  serverSeq: 0,
})

const baby = (overrides: Partial<Baby> = {}): Baby => ({
  id: BABY_ID,
  name: 'Test',
  birthDate: '2025-12-14', // 37 days ≈ 5.3 weeks before NOW → table gain 175
  zoneId: 'Europe/Madrid',
  createdAt: 0,
  updatedAt: 0,
  serverSeq: 0,
  ...overrides,
})

const [T1, T2, T3] = DODOT_SIZES.slice(1, 4) as [DiaperSize, DiaperSize, DiaperSize]

const noSignals: TransitionSignals = {
  tabsNotCentered: false,
  noTwoFingers: false,
  redMarks: false,
  uncoveredButtocks: false,
  frequentDermatitis: false,
  pullsDiaper: false,
}

// ── Population tables ────────────────────────────────────────────────────

describe('weeklyGainG (§8.5)', () => {
  it('tramos de la tabla OMS', () => {
    expect(weeklyGainG(0)).toBe(175)
    expect(weeklyGainG(5.9)).toBe(175)
    expect(weeklyGainG(6)).toBe(150)
    expect(weeklyGainG(16.9)).toBe(150)
    expect(weeklyGainG(17)).toBe(115)
    expect(weeklyGainG(26)).toBe(60)
    expect(weeklyGainG(52)).toBe(40)
    expect(weeklyGainG(80)).toBe(40)
  })
})

// ── Corrected age (§8.5 / §8.8) ──────────────────────────────────────────

describe('correctedAgeWeeks (§8.5)', () => {
  it('prematuro de 34 semanas con 8 de vida → edad corregida 2 semanas', () => {
    const corrected = correctedAgeWeeks({
      birthDate: '2025-11-25', // 56 days = 8 weeks before NOW
      gestationalWeeks: 34,
      now: NOW,
    })
    expect(corrected).toBe(2)
  })

  it('a término → edad corregida = cronológica', () => {
    const corrected = correctedAgeWeeks({
      birthDate: '2025-11-25',
      gestationalWeeks: 40,
      now: NOW,
    })
    expect(corrected).toBe(8)
  })

  it('nunca negativa', () => {
    const corrected = correctedAgeWeeks({
      birthDate: '2026-01-15', // 5 days old
      gestationalWeeks: 34,
      now: NOW,
    })
    expect(corrected).toBe(0)
  })
})

describe('weeksBetween — días naturales, no milisegundos (§8.5)', () => {
  it('cruza el cambio de hora de octubre sin desviarse', () => {
    // Oct 20 → Nov 3 2026: 14 logical days, but 14 d + 1 h of wall clock
    // (DST ends Oct 25). Raw milliseconds would give ≈ 2.006 weeks.
    const from = Date.UTC(2026, 9, 20, 12, 0, 0)
    const to = Date.UTC(2026, 10, 3, 12, 0, 0)
    expect(weeksBetween(from, to)).toBe(2)
  })
})

// ── Signals (§8.3) ───────────────────────────────────────────────────────

describe('signalDays (§8.3)', () => {
  it('1 señal → 3 días, MEDIUM', () => {
    expect(signalDays({ ...noSignals, redMarks: true })).toEqual({
      days: 3,
      confidence: 'MEDIUM',
    })
  })

  it('2+ señales → 0 días, HIGH', () => {
    expect(
      signalDays({ ...noSignals, redMarks: true, pullsDiaper: true })
    ).toEqual({ days: 0, confidence: 'HIGH' })
  })
})

// ── Duration (§8.4) ──────────────────────────────────────────────────────

describe('durationDays (§8.4)', () => {
  it('sin pesos y sin señales, 3 semanas en talla 1 → estimación por duración, LOW', () => {
    const est = durationDays({
      sizeStartedAt: daysAgo(21),
      size: T1, // typicalMonths 1.7 → 51.748 días esperados
      now: NOW,
    })
    expect(est).toEqual({ days: 30, confidence: 'LOW' })
  })

  it('talla sin typicalMonths → null', () => {
    expect(
      durationDays({
        sizeStartedAt: daysAgo(21),
        size: { id: 1, name: 'Talla 1' },
        now: NOW,
      })
    ).toBeNull()
  })

  it('más tiempo del típico → 0 días, no negativo', () => {
    const est = durationDays({
      sizeStartedAt: daysAgo(90),
      size: T1,
      now: NOW,
    })
    expect(est?.days).toBe(0)
    expect(est?.confidence).toBe('LOW')
  })
})

// ── Target weight (§8.5) ─────────────────────────────────────────────────

describe('targetWeightKg (§8.5)', () => {
  it('punto medio del solapamiento T1→T2 = 4,5 kg', () => {
    expect(targetWeightKg(T1, T2)).toBe(4.5)
  })

  it('sin talla siguiente → máximo de la actual', () => {
    expect(targetWeightKg(T1, null)).toBe(5)
  })

  it('talla sin maxWeightKg → null', () => {
    expect(targetWeightKg({ id: 7, name: 'Talla 7' }, T3)).toBeNull()
  })
})

// ── Weight estimation (§8.5) ─────────────────────────────────────────────

describe('estimateWeightKg (§8.5)', () => {
  it('sin birthDate → null', () => {
    const { birthDate: _omitted, ...noBirthDate } = baby()
    void _omitted
    expect(
      estimateWeightKg({
        weights: [mkWeight(4, daysAgo(1))],
        baby: noBirthDate,
        now: NOW,
      })
    ).toBeNull()
  })

  it('sin pesos → null', () => {
    expect(estimateWeightKg({ weights: [], baby: baby(), now: NOW })).toBeNull()
  })

  it('bebé de 10 días → null (descenso fisiológico)', () => {
    expect(
      estimateWeightKg({
        weights: [mkWeight(3.5, daysAgo(2))],
        baby: baby({ birthDate: '2026-01-10' }),
        now: NOW,
      })
    ).toBeNull()
  })

  it('prematuro de 3 semanas de vida con 34 de gestación → null (corregida < 2)', () => {
    expect(
      estimateWeightKg({
        weights: [mkWeight(3.2, daysAgo(1))],
        baby: baby({ birthDate: '2025-12-30', gestationalWeeks: 34 }),
        now: NOW,
      })
    ).toBeNull()
  })

  it('1 peso, sin proyección pendiente → el peso registrado', () => {
    const est = estimateWeightKg({
      weights: [mkWeight(4, daysAgo(3))],
      baby: baby(),
      now: NOW,
    })
    // 3 days of population projection on top of the registered weight
    expect(est?.personal).toBe(false)
    expect(est?.kg).toBeCloseTo(4 + (175 * (3 / 7)) / 1000, 6)
  })
})

describe('observedGainG (§8.5)', () => {
  it('con menos de 2 pesos → null', () => {
    expect(observedGainG([mkWeight(4, NOW)])).toBeNull()
  })

  it('ganancia real de 250 g/sem entre dos pesos', () => {
    const g = observedGainG([mkWeight(4, daysAgo(14)), mkWeight(4.5, NOW)])
    expect(g).toBe(250)
  })

  it('intervalo de 3 días → null (ruido de báscula)', () => {
    expect(observedGainG([mkWeight(4, daysAgo(3)), mkWeight(4.2, NOW)])).toBeNull()
  })

  it('ganancia negativa → null', () => {
    expect(observedGainG([mkWeight(4.2, daysAgo(14)), mkWeight(4.1, NOW)])).toBeNull()
  })

  it('ganancia implausible (> 400 g/sem) → null', () => {
    expect(observedGainG([mkWeight(4, daysAgo(7)), mkWeight(4.5, NOW)])).toBeNull()
  })
})

// ── Honest range (§8.9) ──────────────────────────────────────────────────

describe('weightDaysRange (§8.9)', () => {
  it('1 peso, 4 kg, talla 1, objetivo 4,5 → 20 días, LOW', () => {
    const r = weightDaysRange({
      weights: [mkWeight(4, NOW)],
      baby: baby(),
      current: T1,
      next: T2,
      now: NOW,
    })
    expect(r).toEqual({ min: 15, mid: 20, max: 28, confidence: 'LOW' })
  })

  it('1 peso, 4 kg registrado hoy, sexo masculino → 19 días exactos (183,75 g/sem)', () => {
    const r = weightDaysRange({
      weights: [mkWeight(4, NOW)],
      baby: baby({ sex: 'male' }),
      current: T1,
      next: T2,
      now: NOW,
    })
    expect(r?.mid).toBe(19) // 175 × 1,05 — aplicado UNA sola vez
  })

  it('mismo caso, sexo femenino → 21 días exactos (166,25 g/sem)', () => {
    const r = weightDaysRange({
      weights: [mkWeight(4, NOW)],
      baby: baby({ sex: 'female' }),
      current: T1,
      next: T2,
      now: NOW,
    })
    expect(r?.mid).toBe(21) // 175 × 0,95
  })

  it('neutro → 20 días (la doble aplicación daría 18)', () => {
    const r = weightDaysRange({
      weights: [mkWeight(4, NOW)],
      baby: baby(),
      current: T1,
      next: T2,
      now: NOW,
    })
    expect(r?.mid).toBe(20)
  })

  it('2 pesos con ganancia real 250 g/sem → usa 250, no la tabla; MEDIUM', () => {
    const r = weightDaysRange({
      weights: [mkWeight(3.7, daysAgo(14)), mkWeight(4.2, NOW)],
      baby: baby(),
      current: T1,
      next: T2,
      now: NOW,
    })
    // need = 4,5 − 4,2 kg a 250 g/sem. El borde 7 d cae por coma flotante
    // (4,5 − 4,2 = 0,2999…) → min 6; mid y max estables
    expect(r).toEqual({ min: 6, mid: 8, max: 10, confidence: 'MEDIUM' })
  })

  it('2 pesos con ganancia negativa → ignora y usa la tabla; LOW', () => {
    const r = weightDaysRange({
      weights: [mkWeight(4.2, daysAgo(14)), mkWeight(4.1, NOW)],
      baby: baby(),
      current: T1,
      next: T2,
      now: NOW,
    })
    expect(r?.mid).toBe(16) // 0,4 kg a 175 g/sem
    expect(r?.confidence).toBe('LOW')
  })

  it('2 pesos separados 3 días → intervalo corto, usa la tabla', () => {
    const r = weightDaysRange({
      weights: [mkWeight(4, daysAgo(3)), mkWeight(4.2, NOW)],
      baby: baby(),
      current: T1,
      next: T2,
      now: NOW,
    })
    expect(r?.mid).toBe(11) // 0,3 kg a 175 g/sem — borde FP: 11,999… → 11
    expect(r?.confidence).toBe('LOW')
  })

  it('peso ya sobre el objetivo → 0 días', () => {
    const r = weightDaysRange({
      weights: [mkWeight(4.8, NOW)],
      baby: baby(),
      current: T1,
      next: T2,
      now: NOW,
    })
    expect(r).toEqual({ min: 0, mid: 0, max: 0, confidence: 'LOW' })
  })

  it('talla sin rangos configurados → null', () => {
    expect(
      weightDaysRange({
        weights: [mkWeight(4, NOW)],
        baby: baby(),
        current: { id: 1, name: 'Talla 1' },
        next: T2,
        now: NOW,
      })
    ).toBeNull()
  })

  it('rango con 1,2 kg pendientes a 175 g/sem → min ≈ 37 d, max ≈ 67 d', () => {
    const r = weightDaysRange({
      weights: [mkWeight(5.8, NOW)],
      baby: baby(),
      current: T2,
      next: T3,
      now: NOW,
    })
    expect(r).toEqual({ min: 37, mid: 48, max: 67, confidence: 'LOW' })
  })
})

// ── Combination (§8.1) ───────────────────────────────────────────────────

describe('estimateTransition (§8.1)', () => {
  it('sin pesos, sin señales, sin typicalMonths → null', () => {
    expect(
      estimateTransition({
        signals: noSignals,
        sizeStartedAt: daysAgo(21),
        currentSize: { id: 1, name: 'Talla 1' },
        nextSize: T2,
        weights: [],
        baby: baby(),
        now: NOW,
      })
    ).toBeNull()
  })

  it('sin talla actual (sin SIZE_CHANGE) → solo señales pueden estimar', () => {
    expect(
      estimateTransition({
        signals: noSignals,
        sizeStartedAt: null,
        currentSize: null,
        nextSize: null,
        weights: [mkWeight(4, NOW)],
        baby: baby(),
        now: NOW,
      })
    ).toBeNull()
    expect(
      estimateTransition({
        signals: { ...noSignals, redMarks: true },
        sizeStartedAt: null,
        currentSize: null,
        nextSize: null,
        weights: [],
        baby: baby(),
        now: NOW,
      })
    ).toEqual({ days: 3, confidence: 'MEDIUM' })
  })

  it('señales (3 d) y peso (28 d) → gana el mínimo: 3 días', () => {
    const est = estimateTransition({
      signals: { ...noSignals, redMarks: true },
      sizeStartedAt: daysAgo(21),
      currentSize: T1,
      nextSize: T2,
      weights: [mkWeight(4, NOW)],
      baby: baby(),
      now: NOW,
    })
    expect(est).toEqual({ days: 3, confidence: 'MEDIUM' })
  })

  it('el estimador de peso aporta su extremo pesimista (max, §8.9)', () => {
    const est = estimateTransition({
      signals: noSignals,
      sizeStartedAt: null,
      currentSize: T1,
      nextSize: T2,
      weights: [mkWeight(4, NOW)],
      baby: baby(),
      now: NOW,
    })
    expect(est).toEqual({
      days: 28,
      confidence: 'LOW',
      range: { min: 15, mid: 20, max: 28 },
    })
  })

  it('empate en días → gana la confianza más alta, sea cual sea el orden', () => {
    // Duration elapsed beyond typical → 0 days LOW; two signals → 0 days HIGH
    const est = estimateTransition({
      signals: { ...noSignals, redMarks: true, noTwoFingers: true },
      sizeStartedAt: daysAgo(90),
      currentSize: T1,
      nextSize: T2,
      weights: [],
      baby: baby(),
      now: NOW,
    })
    expect(est).toEqual({ days: 0, confidence: 'HIGH' })

    // Weight already over target (0 days MEDIUM, range {0,0,0}) vs two
    // signals (0 days HIGH): tie → the highest confidence wins
    const est2 = estimateTransition({
      signals: { ...noSignals, redMarks: true, noTwoFingers: true },
      sizeStartedAt: null,
      currentSize: T1,
      nextSize: T2,
      weights: [mkWeight(4.8, NOW)],
      baby: baby(),
      now: NOW,
    })
    expect(est2).toEqual({
      days: 0,
      confidence: 'HIGH',
      range: { min: 0, mid: 0, max: 0 },
    })
  })

  it('solo duración disponible desde el día 1, sin ningún peso (D-24)', () => {
    const est = estimateTransition({
      signals: noSignals,
      sizeStartedAt: daysAgo(21),
      currentSize: T1,
      nextSize: T2,
      weights: [],
      baby: baby(),
      now: NOW,
    })
    expect(est).toEqual({ days: 30, confidence: 'LOW' })
  })
})

// ── Integration with the forecast (§7.5 / §8.6) ──────────────────────────

describe('transición + forecast (§7.5, §8.6)', () => {
  const sevenStableDays = Array.from({ length: 7 }, (_, i) => ({
    id: `u-${String(i)}`,
    babyId: BABY_ID,
    sizeId: 1,
    type: 'USAGE' as const,
    usageSource: 'OWN_STOCK' as const,
    quantity: 6,
    delta: -6,
    occurredAt: daysAgo(i + 2),
    recordedAt: daysAgo(i + 2),
    deviceId: 'device-test',
    serverSeq: 0,
  }))

  it('LOW + stock alto → avisa, NO bloquea', () => {
    const transition = estimateTransition({
      signals: noSignals,
      sizeStartedAt: daysAgo(40), // duración 11 d < 15 d restantes
      currentSize: T1,
      nextSize: T2,
      weights: [],
      baby: baby(),
      now: NOW,
    })
    expect(transition?.confidence).toBe('LOW')
    const f = computeForecast({
      stock: 90, // 90/6 = 15 días restantes
      usage: sevenStableDays,
      now: NOW,
      transition,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.status).toBe('OK')
  })

  it('MEDIUM + stock alto → HOLD_SIZE_CHANGE', () => {
    const transition = estimateTransition({
      signals: { ...noSignals, redMarks: true },
      sizeStartedAt: daysAgo(21),
      currentSize: T1,
      nextSize: T2,
      weights: [],
      baby: baby(),
      now: NOW,
    })
    expect(transition).toEqual({ days: 3, confidence: 'MEDIUM' })
    const f = computeForecast({
      stock: 90, // 15 días restantes > 7 → D-15 no aplica
      usage: sevenStableDays,
      now: NOW,
      transition,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.status).toBe('HOLD_SIZE_CHANGE')
  })

  it('MEDIUM + quedan 5 días → NO bloquea (D-15): BUY_BOTH_SIZES', () => {
    const transition = estimateTransition({
      signals: { ...noSignals, redMarks: true },
      sizeStartedAt: daysAgo(21),
      currentSize: T1,
      nextSize: T2,
      weights: [],
      baby: baby(),
      now: NOW,
    })
    const f = computeForecast({
      stock: 30, // 30/6 = 5 días restantes, lowStock
      usage: sevenStableDays,
      now: NOW,
      transition,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.status).toBe('BUY_BOTH_SIZES')
  })
})
