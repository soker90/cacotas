import { useEffect, useState } from 'react'
import { logicalDate } from '../../../shared/time.ts'
import { usageByDay } from '../../../shared/forecast.ts'
import { lastSizeChange, liveUsage, sizeDurations } from '../../db/derive.ts'
import { db } from '../../db/index.ts'
import { useBaby } from '../../hooks'
import { formatLogicalDateEs } from '../../lib/format-date.ts'

interface StatsData {
  today: number
  yesterday: number | null
  averages: Array<{ windowDays: number; average: number | null }>
  /** Last 30 logical days, oldest first — null = day without data. */
  chart: Array<{ day: string; value: number | null }>
  /** Real days per size from the SIZE_CHANGE ledger (§14). */
  durations: Map<number, number>
  /** The size still open, if any. */
  openSizeId: number | null
}

const WINDOWS = [7, 14, 30] as const

const computeStats = async (babyId: string): Promise<StatsData> => {
  const now = Date.now()
  // liveUsage excludes undone movements and their UNDO records (§6)
  const byDay = usageByDay(await liveUsage(db, babyId, 0))

  const today = byDay.get(logicalDate(now)) ?? 0
  const yesterday = byDay.get(logicalDate(now - 86_400_000)) ?? null

  const averages = WINDOWS.map((windowDays) => {
    let total = 0
    let counted = 0
    for (let i = 1; i <= windowDays; i++) {
      const value = byDay.get(logicalDate(now - i * 86_400_000))
      if (value !== undefined) {
        total += value
        counted++
      }
    }
    return {
      windowDays,
      average: counted > 0 ? total / windowDays : null,
    }
  })

  const chart: Array<{ day: string; value: number | null }> = []
  for (let i = 29; i >= 0; i--) {
    const day = logicalDate(now - i * 86_400_000)
    chart.push({ day, value: byDay.get(day) ?? null })
  }

  const [durations, open] = await Promise.all([
    sizeDurations(db, babyId, now),
    lastSizeChange(db, babyId),
  ])

  return { today, yesterday, averages, chart, durations, openSizeId: open?.sizeId ?? null }
}

/** 7-day moving average over the chart (D-21). Absent days contribute
 *  nothing (D-13): the window averages only the days with data. */
const movingAverage = (
  chart: Array<{ day: string; value: number | null }>
): Array<number | null> =>
  chart.map((_, index) => {
    const window = chart.slice(Math.max(0, index - 6), index + 1)
    const values = window
      .map((point) => point.value)
      .filter((value): value is number => value !== null)
    return values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null
  })

export const Stats = () => {
  const baby = useBaby()
  const [data, setData] = useState<StatsData | undefined>(undefined)
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (baby === undefined || baby === null) return
    const tick = (): void => {
      setNow(Date.now())
      void computeStats(baby.id).then(setData)
    }
    tick()
    const interval = setInterval(tick, 60_000)
    return () => {
      clearInterval(interval)
    }
  }, [baby])

  if (baby === undefined || baby === null || data === undefined) {
    return <main className='loading'>…</main>
  }

  const maxValue = Math.max(1, ...data.chart.map((d) => d.value ?? 0))

  return (
    <main className='page'>
      <h1>Estadísticas</h1>

      <section className='card'>
        <div className='stat-row'>
          <span>Hoy</span>
          <strong>{String(data.today)}</strong>
        </div>
        <div className='stat-row'>
          <span>Ayer</span>
          <strong>
            {data.yesterday === null
              ? (
                <span className='muted'>sin datos</span>
                )
              : (
                  String(data.yesterday)
                )}
          </strong>
        </div>
        {data.averages.map((row) => (
          <div key={row.windowDays} className='stat-row'>
            <span>Media {String(row.windowDays)} días</span>
            <strong>
              {row.average === null
                ? (
                  <span className='muted'>sin datos</span>
                  )
                : (
                    `≈ ${row.average.toFixed(1)}`
                  )}
            </strong>
          </div>
        ))}
      </section>

      <section className='card'>
        <h2>Consumo diario (30 días)</h2>
        <p className='muted small'>
          Los días sin registro se muestran vacíos: son dato ausente, no cero
          (D-13). La línea es la media móvil de 7 días (D-21): muestra la
          tendencia aunque algún día falte registro.
        </p>
        <Chart chart={data.chart} maxValue={maxValue} />
        <p className='muted small'>
          De {formatLogicalDateEs(logicalDate(now - 29 * 86_400_000))} a hoy
        </p>
      </section>

      <section className='card'>
        <h2>Cuánto duró cada talla</h2>
        {data.durations.size === 0
          ? (
            <p className='muted'>
              Todavía no hay cambios de talla que medir.
            </p>
            )
          : (
              [...data.durations.entries()]
                .sort(([a], [b]) => a - b)
                .map(([sizeId, days]) => (
                  <div key={sizeId} className='stat-row'>
                    <span>
                      Talla {String(sizeId)}
                      {sizeId === data.openSizeId && (
                        <span className='muted'> · en curso</span>
                      )}
                    </span>
                    <strong>{days} {days === 1 ? 'día' : 'días'}</strong>
                  </div>
                ))
            )}
      </section>
    </main>
  )
}

/**
 * Bar chart with the 7-day moving-average line overlaid (§14, D-21).
 * SVG so the line can cross the bars; DST-safe days come from the chart
 * data, never from pixel maths.
 */
const Chart = ({
  chart,
  maxValue,
}: {
  chart: Array<{ day: string; value: number | null }>
  maxValue: number
}) => {
  const ma = movingAverage(chart)
  const slot = 320 / chart.length
  const barWidth = slot * 0.65
  const usable = 110 // viewBox height 120 minus baseline/top margins

  const maSegments: string[] = []
  let current: string[] = []
  ma.forEach((value, index) => {
    if (value === null) {
      if (current.length > 1) maSegments.push(current.join(' '))
      current = []
      return
    }
    const cx = index * slot + slot / 2
    const cy = 115 - (value / maxValue) * usable
    current.push(`${cx.toFixed(1)},${cy.toFixed(1)}`)
  })
  if (current.length > 1) maSegments.push(current.join(' '))

  return (
    <svg
      className='chart-svg'
      role='img'
      aria-label='Consumo diario de los últimos 30 días con la media móvil de 7 días'
      viewBox='0 0 320 120'
      preserveAspectRatio='none'
    >
      {chart.map((point, index) => {
        if (point.value === null) return null
        const height = (point.value / maxValue) * usable
        return (
          <rect
            key={point.day}
            className='chart-bar'
            x={index * slot + (slot - barWidth) / 2}
            y={115 - height}
            width={barWidth}
            height={Math.max(height, 1)}
          >
            <title>{`${point.day}: ${String(point.value)} pañales`}</title>
          </rect>
        )
      })}
      {maSegments.map((points) => (
        <polyline key={points} className='chart-ma' points={points} />
      ))}
      <line x1='0' x2='320' y1='115.5' y2='115.5' className='chart-base' />
    </svg>
  )
}
