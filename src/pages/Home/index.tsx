import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Forecast } from '../../../shared/forecast.ts'
import type { Baby } from '../../../shared/types.ts'
import {
  useCurrentSize,
  useForecast,
  useRecordMovement,
  useStockBySize,
} from '../../hooks'
import {
  confidenceLabel,
  forecastCaveats,
  forecastHeadline,
} from '../../lib/forecast-texts.ts'
import { formatLogicalDateEs } from '../../lib/format-date.ts'
import { getCoverageDays } from '../../lib/settings.ts'
import { isStayMode } from '../../lib/stay-mode.ts'
import { lastSyncAt } from '../../sync/engine.ts'
import { WeightForm, useWeightReminder } from '../../components/WeightForm.tsx'
import { TransitionPrompt } from '../../components/TransitionPrompt.tsx'

export const Home = ({ baby }: { baby: Baby }) => {
  const sizeId = useCurrentSize(baby.id)
  const stocks = useStockBySize(baby.id)
  const { recordDiaper, undoLast, lastUsage } = useRecordMovement(baby.id)
  const forecast = useForecast(baby.id, sizeId)
  // Route changes remount this page, so the flag is read fresh each time
  const [stayMode] = useState(() => isStayMode())
  const weightReminder = useWeightReminder(baby.id)

  const stock =
    typeof sizeId === 'number' ? (stocks?.get(sizeId) ?? 0) : null

  const handleRecordDiaper = (): void => {
    if (typeof sizeId === 'number') void recordDiaper(sizeId)
  }

  return (
    <main className='home'>
      <header className='home-header'>
        <h1 className='home-title'>
          <span aria-hidden='true'>👶 </span>
          {baby.name}
          {typeof sizeId === 'number' ? ` · Talla ${String(sizeId)}` : ''}
        </h1>
        <Link to='/settings' aria-label='Ajustes' className='header-link'>
          ⚙️
        </Link>
      </header>

      {stayMode && (
        <p className='stay-banner' role='status'>
          🏥 Modo estancia activo — los pañales no descuentan stock
        </p>
      )}

      <button
        type='button'
        className='big-button'
        disabled={typeof sizeId !== 'number'}
        onClick={handleRecordDiaper}
      >
        🧷 PAÑAL GASTADO
      </button>

      {lastUsage && (
        <p className='toast' role='status'>
          Registrado.{' '}
          <button
            type='button'
            onClick={() => {
              void undoLast()
            }}
          >
            Deshacer
          </button>
        </p>
      )}

      <section className='stock'>
        {sizeId === undefined
          ? (
            <p className='muted'>Cargando…</p>
            )
          : stock === null
            ? (
              <p className='muted'>Sin talla actual</p>
              )
            : (
              <p>
                {stock} pañales
                {typeof forecast?.dailyConsumption === 'number' &&
                  ` · ≈ ${forecast.dailyConsumption.toFixed(1)}/día`}
                {typeof forecast?.daysRemaining === 'number' &&
                  ` · quedan ≈ ${String(Math.round(forecast.daysRemaining))} días`}
                {forecast?.exhaustionDate != null && ` · se acaban el ${formatLogicalDateEs(forecast.exhaustionDate)}`}
                {stock < 0 && (
                  <strong className='warn'> · revisa el inventario</strong>
                )}
              </p>
              )}
      </section>

      {forecast !== null && forecast !== undefined && sizeId != null && (
        <ForecastCard forecast={forecast} sizeId={sizeId} />
      )}

      {typeof sizeId === 'number' && <TransitionPrompt baby={baby} sizeId={sizeId} />}

      {weightReminder && (
        <p className='muted small' role='status'>
          ¿Cuánto pesa ya?
        </p>
      )}

      <WeightForm baby={baby} />

      <footer className='home-footer'>
        <Link to='/record' className='secondary-action'>
          ＋ Registrar varios
        </Link>
      </footer>

      <SyncIndicator />
    </main>
  )
}

/** Status headline + caveats + confidence bar (§10 Home). */
const ForecastCard = ({
  forecast,
  sizeId,
}: {
  forecast: Forecast
  sizeId: number
}) => {
  const confidence = confidenceLabel(forecast)
  const confidenceWidth =
    forecast.confidence === 'HIGH'
      ? 100
      : forecast.confidence === 'MEDIUM'
        ? 60
        : forecast.confidence === 'LOW'
          ? 25
          : 0

  return (
    <section className='forecast-card'>
      <p className='forecast-headline'>{forecastHeadline(forecast, sizeId)}</p>
      {forecast.recommendedDiapers !== null && forecast.recommendedDiapers > 0 && (
        <p className='forecast-buy'>
          🛒 Te faltan ≈ {String(forecast.recommendedDiapers)} pañales para
          {' '}
          {String(getCoverageDays())} días de colchón.
        </p>
      )}
      {forecastCaveats(forecast).map((caveat) => (
        <p key={caveat} className='muted small'>
          {caveat}
        </p>
      ))}
      {confidence !== null && (
        <div className='confidence'>
          <div className='confidence-bar' aria-hidden='true'>
            <div style={{ width: `${String(confidenceWidth)}%` }} />
          </div>
          <span className='muted small'>{confidence}</span>
        </div>
      )}
    </section>
  )
}

/** Discreet "synced X ago" (§9.3) — a failed sync is never an error. */
const SyncIndicator = () => {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const tick = (): void => {
      setNow(Date.now())
    }
    tick()
    const interval = setInterval(tick, 30_000)
    return () => {
      clearInterval(interval)
    }
  }, [])

  if (now === null) return null

  const last = lastSyncAt()
  const text =
    last === null
      ? 'sin sincronizar'
      : `sincronizado ${relativeTime(now - last)}`
  return <p className='sync-indicator muted'>{text}</p>
}

const relativeTime = (elapsedMs: number): string => {
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) return 'ahora mismo'
  if (minutes < 60) return `hace ${String(minutes)} min`
  const hours = Math.floor(minutes / 60)
  return `hace ${String(hours)} h`
}
