import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import type { Forecast } from '../../../shared/forecast.ts'
import { estimatePurchaseNeeds, type PurchaseNeeds } from '../../../shared/needs.ts'
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
import { getCoverageDays, getWarningDays } from '../../lib/settings.ts'
import { getPurchaseTiming } from '../../../shared/purchase-timing.ts'
import { purchaseTimingDetail, purchaseTimingHeadline } from '../../lib/purchase-timing-texts.ts'
import { isStayMode } from '../../lib/stay-mode.ts'
import { lastSyncAt } from '../../sync/engine.ts'
import { db } from '../../db/index.ts'
import { defaultLocationId, ensureDefaultLocation, getActiveLocationId, setActiveLocationId } from '../../lib/locations.ts'
import { WeightForm, useWeightReminder } from '../../components/WeightForm.tsx'
import { TransitionPrompt } from '../../components/TransitionPrompt.tsx'

export const Home = ({ baby }: { baby: Baby }) => {
  const sizeId = useCurrentSize(baby.id)
  const locations = useLiveQuery(() => db.locations.toArray())
  const fallbackLocationId = defaultLocationId(baby.id)
  const [activeLocationId, setActiveLocationIdState] = useState(() => getActiveLocationId(fallbackLocationId))
  const selectedLocationId = locations?.some((location) => location.id === activeLocationId)
    ? activeLocationId
    : locations?.[0]?.id ?? activeLocationId
  const activeLocation = locations?.find((location) => location.id === selectedLocationId)
  const locationId = selectedLocationId
  const stocks = useStockBySize(baby.id, locationId)
  const nextSize = useLiveQuery(
    () => typeof sizeId === 'number' ? db.sizes.get(sizeId + 1) : undefined,
    [sizeId]
  )
  const { recordDiaper, undoLast, lastUsage, isRecording } = useRecordMovement(baby.id, locationId)
  const forecast = useForecast(baby.id, sizeId, locationId)
  // Route changes remount this page, so the flag is read fresh each time
  const [stayMode] = useState(() => isStayMode())
  const weightReminder = useWeightReminder(baby.id)

  useEffect(() => {
    void ensureDefaultLocation(baby.id)
  }, [baby.id])

  const stock =
    typeof sizeId === 'number' ? (stocks?.get(sizeId) ?? 0) : null
  const purchaseTiming =
    forecast !== null && forecast !== undefined
      ? getPurchaseTiming({
        daysRemaining: forecast.daysRemaining,
        transitionDays: forecast.transition?.days ?? null,
        warningDays: getWarningDays(),
        watchDays: getWarningDays() * 2,
        confidence: forecast.confidence,
        seeded: forecast.seeded,
      })
      : null

  const purchaseNeeds =
    typeof sizeId === 'number' && forecast !== null && forecast !== undefined && nextSize !== undefined
      ? estimatePurchaseNeeds({
        currentStock: stocks?.get(sizeId) ?? 0,
        nextStock: stocks?.get(nextSize.id) ?? 0,
        currentDailyConsumption: forecast.dailyConsumption,
        nextDailyConsumption: nextSize.dailyDiapers ?? null,
        transitionDays: forecast.transition?.days ?? null,
        horizonDays: getCoverageDays(),
      })
      : null

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
        {locations !== undefined && locations.length > 1 && (
          <label className='location-selector'>
            <select
              value={selectedLocationId}
              onChange={(event) => {
                const next = event.target.value
                setActiveLocationId(next)
                setActiveLocationIdState(next)
              }}
              aria-label='Ubicación activa'
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
            <span aria-hidden='true'>📍</span>
          </label>
        )}
        <Link to='/settings' aria-label='Ajustes' className='header-link'>
          ⚙️
        </Link>
      </header>

      {stayMode && (
        <p className='stay-banner' role='status'>
          🏥 Modo estancia activo — los pañales no descuentan stock
        </p>
      )}

      <section className='home-action'>
        <p className='section-kicker'>Registro rápido</p>
        <button type='button' className='big-button' disabled={typeof sizeId !== 'number' || isRecording} onClick={handleRecordDiaper}>
          {isRecording ? 'Registrando…' : '🧷 PAÑAL GASTADO'}
        </button>

        {lastUsage && (
          <p className='toast' role='status'>
            Registrado.{' '}
            <button
              type='button'
              onClick={() => {
                navigator.vibrate?.(15)
                void undoLast()
              }}
            >
              Deshacer
            </button>
          </p>
        )}
      </section>

      <section className='stock-card'>
        <div className='section-heading'>
          <div>
            <p className='section-kicker'>Inventario</p>
            <h2>Lo que tienes ahora</h2>
          </div>
          <Link to='/inventory' className='section-link'>Ver todo →</Link>
        </div>
        <div className='stock-summary'>
          {sizeId === undefined
            ? <p className='muted'>Cargando…</p>
            : stock === null
              ? <p className='muted'>Sin talla actual</p>
              : (
                <>
                  <div className='stock-number'>{stock}</div>
                  <div className='stock-label'>pañales de talla {String(sizeId)}</div>
                  <div className='stock-location'>📍 {activeLocation?.name ?? 'Ubicación activa'}</div>
                  {stock < 0 && <p className='warn small'>Revisa el inventario.</p>}
                </>
                )}
        </div>
      </section>

      {forecast !== null && forecast !== undefined && sizeId != null && (
        <ForecastCard forecast={forecast} sizeId={sizeId} purchaseNeeds={purchaseNeeds} nextSizeId={nextSize?.id ?? null} purchaseTiming={purchaseTiming} />
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
  purchaseNeeds,
  nextSizeId,
  purchaseTiming,
}: {
  forecast: Forecast
  sizeId: number
  purchaseNeeds: PurchaseNeeds | null
  nextSizeId: number | null
  purchaseTiming: ReturnType<typeof getPurchaseTiming>
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
      <div className='section-heading'>
        <div>
          <p className='section-kicker'>Previsión</p>
          <h2>¿Qué viene después?</h2>
        </div>
        <span className='confidence-pill'>{confidence ?? 'Sin datos'}</span>
      </div>
      <p className='forecast-headline'>{forecastHeadline(forecast, sizeId)}</p>
      <div className='forecast-metrics'>
        <div>
          <strong>{typeof forecast.daysRemaining === 'number' ? Math.max(0, Math.round(forecast.daysRemaining)) : '—'}</strong>
          <span>días de stock</span>
        </div>
        <div>
          <strong>{typeof forecast.dailyConsumption === 'number' ? forecast.dailyConsumption.toFixed(1) : '—'}</strong>
          <span>pañales/día</span>
        </div>
        {forecast.transition !== null && (
          <div>
            <strong>≈ {String(forecast.transition.days)}</strong>
            <span>días hasta talla {String(nextSizeId ?? 'siguiente')}</span>
          </div>
        )}
      </div>
      {forecast.exhaustionDate != null && (
        <p className='muted small forecast-date'>
          El stock actual cubriría hasta el {formatLogicalDateEs(forecast.exhaustionDate)}.
        </p>
      )}
      {purchaseTiming !== null && (
        <div className='forecast-buy' role='status'>
          <p><strong>🛒 Plan de acopio</strong></p>
          <p>{purchaseTimingHeadline(purchaseTiming, sizeId)}</p>
          <p>{purchaseTimingDetail(purchaseTiming)}</p>
        </div>
      )}
      {forecast.recommendedDiapers !== null && forecast.recommendedDiapers > 0 && (
        <p className='forecast-buy'>
          🛒 Te faltan ≈ {String(forecast.recommendedDiapers)} pañales para
          {' '}
          {String(getCoverageDays())} días de colchón.
        </p>
      )}
      {purchaseNeeds !== null && purchaseNeeds.next > 0 && (
        <div className='forecast-needs'>
          <p className='forecast-buy'>🛒 Necesidades estimadas para los próximos {String(getCoverageDays())} días:</p>
          {purchaseNeeds.current > 0 && (
            <p className='muted small'>Talla {String(sizeId)}: ≈ {String(purchaseNeeds.current)} pañales</p>
          )}
          {purchaseNeeds.next > 0 && nextSizeId !== null && (
            <p className='muted small'>Talla {String(nextSizeId)}: ≈ {String(purchaseNeeds.next)} pañales</p>
          )}
          {forecast.transition !== null && purchaseNeeds.nextDays > 0 && (
            <p className='muted small'>
              La previsión reparte la necesidad entre ambas tallas según el cambio estimado en ≈ {String(forecast.transition.days)} días.
            </p>
          )}
        </div>
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
