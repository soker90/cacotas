import { describe, expect, it } from 'vitest'
import { computeForecast, usageByDay } from '../shared/forecast.ts'
import { DODOT_SIZES } from '../shared/transition.ts'
import { signalDays } from '../shared/transition.ts'
import type { Movement, TransitionSignals } from '../shared/types.ts'

const BABY = 'baby-f'
// January: no DST in Europe/Madrid — UTC noon is a safe mid-day instant.
const DAY = (index: number): number =>
  Date.UTC(2026, 0, 5 + index, 12, 0, 0)

let counter = 0
const uid = (): string => `f-${(counter++).toString().padStart(4, '0')}`

/** One OWN_STOCK usage of `quantity` on logical day `dayIndex`. */
const usageOn = (dayIndex: number, quantity = 1): Movement => ({
  id: uid(),
  babyId: BABY,
  sizeId: 2,
  type: 'USAGE',
  usageSource: 'OWN_STOCK',
  quantity,
  delta: -quantity,
  occurredAt: DAY(dayIndex),
  recordedAt: DAY(dayIndex) + 60_000,
  deviceId: 'device-test',
  serverSeq: 0,
})

const externalOn = (dayIndex: number): Movement => ({
  ...usageOn(dayIndex),
  usageSource: 'EXTERNAL',
  delta: 0,
})

/** Builds `perDay` usages for each index in `days`, plus `now` on day 100. */
const build = (
  days: Array<[number, number]>,
  nowDay = 100
): { usage: Movement[]; now: number } => {
  const usage = days.flatMap(([day, perDay]) =>
    Array.from({ length: perDay }, () => usageOn(day))
  )
  return { usage, now: DAY(nowDay) }
}

const forecast = (
  days: Array<[number, number]>,
  stock: number,
  extra: Partial<Parameters<typeof computeForecast>[0]> = {}
) =>
  computeForecast({
    stock,
    usage: build(days).usage,
    now: build(days).now,
    transition: null,
    currentSize: null,
    warningDays: 7,
    coverageDays: 21,
    ...extra,
  })

describe('forecast — casos del issue #5', () => {
  it('stock 70 con consumo 7/día → 10 días', () => {
    // 10 días estables de 7
    const f = forecast(
      [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]],
      70
    )
    expect(f.dailyConsumption).toBe(7)
    expect(f.daysRemaining).toBe(10)
    expect(f.status).toBe('OK')
  })

  it('stock 0 → 0 días', () => {
    const f = forecast(
      [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5]],
      0
    )
    expect(f.daysRemaining).toBe(0)
    expect(f.status).toBe('BUY_NOW')
  })

  it('sin historial → NO_DATA', () => {
    const f = forecast([], 50)
    expect(f.status).toBe('NO_DATA')
    expect(f.dailyConsumption).toBeNull()
    expect(f.confidence).toBe('NONE')
  })

  it('solo pañales EXTERNAL → NO_DATA (D-05)', () => {
    const usage = [
      externalOn(1),
      externalOn(2),
      externalOn(3),
      externalOn(4),
      externalOn(5),
    ]
    const f = computeForecast({
      stock: 50,
      usage,
      now: DAY(100),
      transition: null,
      currentSize: null,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.status).toBe('NO_DATA')
  })

  it('días sin registro intercalados no hunden la media', () => {
    // 7 días con registro de 6, separados por huecos sin registro
    const f = forecast(
      [[1, 6], [3, 6], [5, 6], [7, 6], [9, 6], [11, 6], [13, 6]],
      60
    )
    expect(f.daysCovered).toBe(7)
    expect(f.dailyConsumption).toBeCloseTo(6)
    // coverage < 0.6 baja la confianza, pero el consumo no se hunde
  })

  it('un día con 1 registro entre días de 7 → la mediana lo absorbe', () => {
    const f = forecast(
      [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 1], [7, 7]],
      70
    )
    // mediana(last7)=7, mediana(last3)=7 → 7
    expect(f.dailyConsumption).toBe(7)
  })

  it('registros de dos tallas se agregan juntos (D-12)', () => {
    const day = (i: number, q: number): Movement => {
      const m = usageOn(i, q)
      return m
    }
    const usage = [
      ...Array.from({ length: 3 }, (_, i) => day(i, 2)), // talla 2 implícita
      ...Array.from({ length: 8 }, (_, i) => day(i + 10, 3)),
    ]
    // Reasignar la mitad a otra talla para probar D-12
    const mixed: Movement[] = usage.map((m, i) =>
      i % 2 === 0 ? { ...m, sizeId: 1 } : m
    )
    const f = computeForecast({
      stock: 40,
      usage: mixed,
      now: DAY(100),
      transition: null,
      currentSize: null,
      warningDays: 7,
      coverageDays: 21,
    })
    // Últimos 7 días naturales: cada uno tiene 3 (repartidos entre tallas)
    expect(f.dailyConsumption).toBe(3)
  })

  it('consumo reciente al alza → la predicción reacciona', () => {
    const f = forecast(
      [
        [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3],
        [7, 3], [8, 3], [9, 3],
        [10, 12], [11, 12], [12, 12], [13, 12],
      ],
      100
    )
    // Baseline 3/día; el pico reciente domina ambas medianas
    expect(f.dailyConsumption).toBeGreaterThan(9)
    expect(f.dailyConsumption).toBeLessThanOrEqual(12)
  })

  it('cambio de talla en 8 d con confianza MEDIUM → HOLD_SIZE_CHANGE (§7.5)', () => {
    const f = forecast(
      [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5]],
      60, // 60/5 = 12 días restantes
      { transition: { days: 8, confidence: 'MEDIUM' } }
    )
    expect(f.daysRemaining).toBe(12)
    expect(f.status).toBe('HOLD_SIZE_CHANGE')
  })

  it('cambio de talla en 8 d con confianza LOW → avisa, NO bloquea (§8.6)', () => {
    const f = forecast(
      [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5]],
      60,
      { transition: { days: 8, confidence: 'LOW' } }
    )
    expect(f.status).toBe('OK')
  })

  it('cambio de talla en 3 d y agotamiento en 5 d → BUY_BOTH_SIZES (D-15)', () => {
    const f = forecast(
      [[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [7, 6]],
      30, // 30/6 = 5 días restantes, lowStock (≤42)
      { transition: { days: 3, confidence: 'HIGH' } }
    )
    expect(f.status).toBe('BUY_BOTH_SIZES')
  })

  it('98 necesarios con paquetes de 30 → 4 paquetes', () => {
    const f = forecast(
      [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]],
      49, // 7/día → necesita ceil(7*21)=147 − 49 = 98
      { diapersPerPackage: 30 }
    )
    expect(f.recommendedDiapers).toBe(98)
    expect(f.recommendedPackages).toBe(4)
  })

  it('1 día de datos → confianza LOW', () => {
    const f = forecast([[1, 6]], 60)
    expect(f.daysCovered).toBe(1)
    expect(f.confidence).toBe('LOW')
  })

  it('20 días estables → confianza HIGH', () => {
    const days: Array<[number, number]> = []
    for (let i = 1; i <= 20; i++) days.push([i, 6])
    const f = forecast(days, 200)
    expect(f.confidence).toBe('HIGH')
  })

  it('20 días erráticos → confianza MEDIUM', () => {
    const pattern = [2, 12, 3, 11, 2, 13, 3, 12, 2, 11]
    const days: Array<[number, number]> = []
    for (let i = 1; i <= 20; i++) days.push([i, pattern[(i - 1) % pattern.length] ?? 6])
    const f = forecast(days, 150)
    expect(f.variabilityHigh).toBe(true)
    expect(f.confidence).toBe('MEDIUM')
  })
})

describe('forecast — detalles del SPEC §7', () => {
  it('excluye el día en curso aunque tenga registros', () => {
    // Hoy es DAY(100); registros HOY no cuentan
    const f = forecast([[99, 6], [100, 50]], 60)
    expect(f.dailyConsumption).toBe(6)
  })

  it('exhaustionDate coherente con daysRemaining', () => {
    const { now } = build([[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]])
    const f = computeForecast({
      stock: 70,
      usage: build([[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]).usage,
      now,
      transition: null,
      currentSize: null,
      warningDays: 7,
      coverageDays: 21,
    })
    // 10 días desde el día lógico de now
    expect(f.exhaustionDate).not.toBeNull()
  })

  it('recommendedDiapers nunca negativo', () => {
    const f = forecast(
      [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]],
      300
    )
    expect(f.recommendedDiapers).toBe(0)
  })
})

describe('usageByDay', () => {
  it('agrupa por día lógico excluyendo EXTERNAL', () => {
    const byDay = usageByDay([
      usageOn(1, 2),
      usageOn(1, 1),
      externalOn(1),
      usageOn(2, 3),
    ])
    expect(byDay.get('2026-01-06')).toBe(3)
    expect(byDay.get('2026-01-07')).toBe(3)
  })
})

describe('signalDays (§8.3)', () => {
  const signals = (overrides: Partial<TransitionSignals>): TransitionSignals => ({
    tabsNotCentered: false,
    noTwoFingers: false,
    redMarks: false,
    uncoveredButtocks: false,
    frequentDermatitis: false,
    pullsDiaper: false,
    ...overrides,
  })

  it('0 señales → null', () => {
    expect(signalDays(signals({}))).toBeNull()
  })

  it('1 señal → 3 días, MEDIUM', () => {
    expect(signalDays(signals({ redMarks: true }))).toEqual({
      days: 3,
      confidence: 'MEDIUM',
    })
    expect(signalDays(signals({ noTwoFingers: true }))).toEqual({
      days: 3,
      confidence: 'MEDIUM',
    })
  })

  it('2+ señales → 0 días, HIGH', () => {
    expect(signalDays(signals({ redMarks: true, noTwoFingers: true }))).toEqual({
      days: 0,
      confidence: 'HIGH',
    })
    expect(
      signalDays(
        signals({
          redMarks: true,
          noTwoFingers: true,
          tabsNotCentered: true,
        })
      )
    ).toEqual({ days: 0, confidence: 'HIGH' })
  })
})

describe('arranque en frío (§7.2.1, issue #11)', () => {
  const size1 = DODOT_SIZES[1]! // dailyDiapers: 9

  it('sin historial, talla 1 → 9/día, LOW, seeded: true', () => {
    const f = computeForecast({
      stock: 100,
      usage: [],
      now: DAY(100),
      transition: null,
      currentSize: size1,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.dailyConsumption).toBe(9)
    expect(f.daysRemaining).toBe(11)
    expect(f.confidence).toBe('LOW')
    expect(f.daysCovered).toBe(0)
    expect(f.seeded).toBe(true)
    expect(f.status).toBe('OK')
    expect(f.exhaustionDate).not.toBeNull()
  })

  it('sin historial, talla sin dailyDiapers → NO_DATA', () => {
    const f = computeForecast({
      stock: 50,
      usage: [],
      now: DAY(100),
      transition: null,
      currentSize: { id: 1, name: 'Talla 1' },
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.status).toBe('NO_DATA')
    expect(f.dailyConsumption).toBeNull()
    expect(f.seeded).toBe(false)
  })

  it('1 día de historial ya sustituye a la semilla (SPEC §7.2.1)', () => {
    const f = computeForecast({
      stock: 50,
      usage: [usageOn(99, 4)],
      now: DAY(100),
      transition: null,
      currentSize: size1,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.seeded).toBe(false)
    expect(f.dailyConsumption).toBe(4)
  })

  it('3 días de historial → dato real, seeded: false', () => {
    const f = computeForecast({
      stock: 50,
      usage: [usageOn(98, 5), usageOn(99, 5), usageOn(97, 5)],
      now: DAY(100),
      transition: null,
      currentSize: size1,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.seeded).toBe(false)
    expect(f.dailyConsumption).toBe(5)
  })

  it('seeded + cambio de talla próximo (MEDIUM) → NO bloquea la compra', () => {
    const f = computeForecast({
      stock: 100, // 100/9 = 11 días restantes, sin stock bajo
      usage: [],
      now: DAY(100),
      transition: { days: 8, confidence: 'MEDIUM' },
      currentSize: size1,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.seeded).toBe(true)
    expect(f.status).toBe('OK') // no HOLD_SIZE_CHANGE (§7.2.1)
  })

  it('seeded + stock bajo → sí recomienda comprar', () => {
    const f = computeForecast({
      stock: 20,
      usage: [],
      now: DAY(100),
      transition: null,
      currentSize: size1,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.status).toBe('BUY_NOW')
    expect(f.recommendedDiapers).toBe(169) // ceil(9·21) − 20
  })

  it('seeded + stock bajo y cambio en 3 d → BUY_BOTH_SIZES', () => {
    const f = computeForecast({
      stock: 40, // 40/9 = 4 días restantes > 3 de la transición
      usage: [],
      now: DAY(100),
      transition: { days: 3, confidence: 'HIGH' },
      currentSize: size1,
      warningDays: 7,
      coverageDays: 21,
    })
    expect(f.status).toBe('BUY_BOTH_SIZES')
  })
})
