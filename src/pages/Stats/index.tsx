import { useEffect, useState } from 'react'
import { logicalDate } from '../../../shared/time.ts'
import { usageByDay } from '../../../shared/forecast.ts'
import { liveUsage } from '../../db/derive.ts'
import { db } from '../../db/index.ts'
import { useBaby } from '../../hooks'
import { formatLogicalDateEs } from '../../lib/format-date.ts'

interface StatsData {
  today: number
  yesterday: number | null
  averages: Array<{ windowDays: number; average: number | null }>
  /** Last 30 logical days, oldest first — null = day without data. */
  chart: Array<{ day: string; value: number | null }>
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

  return { today, yesterday, averages, chart }
}

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
          (D-13).
        </p>
        <div className='chart' role='img' aria-label='Consumo diario de los últimos 30 días'>
          {data.chart.map((point) => (
            <div
              key={point.day}
              className={point.value === null ? 'chart-slot empty' : 'chart-slot'}
              title={`${point.day}: ${point.value === null ? 'sin registro' : `${String(point.value)} pañales`}`}
            >
              {point.value !== null && (
                <div
                  className='chart-bar'
                  style={{ height: `${String(Math.round((point.value / maxValue) * 100))}%` }}
                />
              )}
            </div>
          ))}
        </div>
        <p className='muted small'>
          De {formatLogicalDateEs(logicalDate(now - 29 * 86_400_000))} a hoy
        </p>
      </section>
    </main>
  )
}
