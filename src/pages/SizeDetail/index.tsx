import { useState } from 'react'
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createMovement } from '../../../shared/factory.ts'
import { usageByDay } from '../../../shared/forecast.ts'
import { logicalDate } from '../../../shared/time.ts'
import type { Baby, TransitionSignals } from '../../../shared/types.ts'
import { liveUsage } from '../../db/derive.ts'
import { db } from '../../db/index.ts'
import {
  useCurrentSize,
  useForecast,
  useStockBySize,
} from '../../hooks'
import {
  clearSignals,
  readSignals,
  writeSignal,
} from '../../lib/transition-signals.ts'
import { confidenceLabel } from '../../lib/forecast-texts.ts'
import { formatLogicalDateEs } from '../../lib/format-date.ts'
import { getDeviceId } from '../../sync/device-id.ts'
import { uuid } from '../../lib/uuid.ts'
import { notifyWrite } from '../../sync/scheduler.ts'

const parsePositive = (text: string): number | null => {
  const value = Number.parseInt(text, 10)
  return Number.isInteger(value) && value >= 1 ? value : null
}

export const SizeDetail = ({ baby }: { baby: Baby }) => {
  const { sizeId: rawSizeId } = useParams()
  const navigate = useNavigate()
  const sizeId = Number.parseInt(rawSizeId ?? '', 10)

  const stocks = useStockBySize(baby.id)
  const currentSizeId = useCurrentSize(baby.id)
  const forecast = useForecast(baby.id, Number.isInteger(sizeId) ? sizeId : null)
  const [signals, setSignals] = useState<TransitionSignals>(() =>
    readSignals(baby.id, sizeId)
  )

  const [packagesText, setPackagesText] = useState('1')
  const [perPackageText, setPerPackageText] = useState('30')
  const [adjustNewText, setAdjustNewText] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!Number.isInteger(sizeId) || sizeId < 0 || sizeId > 6) {
    return (
      <Navigate to='/inventory' replace />
    )
  }

  if (stocks === undefined || currentSizeId === undefined) {
    return <main className='loading'>…</main>
  }

  const stock = stocks.get(sizeId) ?? 0
  const isCurrent = currentSizeId === sizeId

  const addPurchase = async (): Promise<void> => {
    const packages = parsePositive(packagesText)
    const perPackage = parsePositive(perPackageText)
    if (packages === null || perPackage === null) {
      setError('Paquetes y pañales por paquete deben ser enteros ≥ 1')
      return
    }
    const now = Date.now()
    const movement = createMovement(
      {
        id: uuid(),
        babyId: baby.id,
        sizeId,
        deviceId: getDeviceId(),
        occurredAt: now,
        recordedAt: now,
      },
      { type: 'PURCHASE', quantity: packages * perPackage }
    )
    await db.movements.add(movement)
    notifyWrite()
    setError(null)
    setPackagesText('1')
  }

  const addAdjustment = async (): Promise<void> => {
    // The delta is computed against the live stock at save time — the form
    // stores a difference, never an absolute value taken when it opened.
    const freshStock = stocks.get(sizeId) ?? 0
    const newValue = Number.parseInt(adjustNewText, 10)
    if (!Number.isInteger(newValue) || newValue < 0) {
      setError('El nuevo valor debe ser un entero ≥ 0')
      return
    }
    const delta = newValue - freshStock
    if (delta === 0) {
      setError('El nuevo valor es igual al actual: no hay nada que ajustar')
      return
    }
    const now = Date.now()
    const movement = createMovement(
      {
        id: uuid(),
        babyId: baby.id,
        sizeId,
        deviceId: getDeviceId(),
        occurredAt: now,
        recordedAt: now,
        ...(adjustNote.trim() !== '' ? { note: adjustNote.trim() } : {}),
      },
      { type: 'ADJUSTMENT', delta }
    )
    await db.movements.add(movement)
    notifyWrite()
    setError(null)
    setAdjustNewText('')
    setAdjustNote('')
  }

  const changeToThisSize = async (): Promise<void> => {
    if (isCurrent || typeof currentSizeId !== 'number') return
    if (
      !window.confirm(
        `¿Cambiar a Talla ${String(sizeId)}? Te quedan ${String(
          stocks.get(currentSizeId) ?? 0
        )} pañales de la talla ${String(currentSizeId)}.`
      )
    ) {
      return
    }
    const now = Date.now()
    const movement = createMovement(
      {
        id: uuid(),
        babyId: baby.id,
        sizeId,
        deviceId: getDeviceId(),
        occurredAt: now,
        recordedAt: now,
      },
      { type: 'SIZE_CHANGE' }
    )
    await db.movements.add(movement)
    // The signals described the old size — clear them (§8)
    clearSignals(baby.id, currentSizeId)
    notifyWrite()
    void navigate('/inventory')
  }

  return (
    <main className='page'>
      <p className='breadcrumb'>
        <Link to='/inventory'>← Inventario</Link>
      </p>
      <h1>Talla {String(sizeId)}</h1>

      <section className='detail-stock'>
        <span className='stock-big'>{stock}</span> pañales
        {stock < 0 && <strong className='warn'> · revisa el inventario</strong>}
      </section>

      <section className='card'>
        <h2>🛒 Compra</h2>
        <div className='form-row'>
          <label htmlFor='packages'>Paquetes</label>
          <input
            id='packages'
            inputMode='numeric'
            value={packagesText}
            onChange={(e) => {
              setPackagesText(e.target.value)
            }}
          />
        </div>
        <div className='form-row'>
          <label htmlFor='per-package'>Pañales por paquete</label>
          <input
            id='per-package'
            inputMode='numeric'
            value={perPackageText}
            onChange={(e) => {
              setPerPackageText(e.target.value)
            }}
          />
        </div>
        <button
          type='button'
          className='primary'
          onClick={() => {
            void addPurchase()
          }}
        >
          Añadir compra
        </button>
      </section>

      <section className='card'>
        <h2>🧮 Ajustar inventario</h2>
        <p className='muted'>
          Guarda la diferencia con el stock real de ahora mismo, no el número
          que vieras al abrir el formulario.
        </p>
        <div className='form-row'>
          <label htmlFor='adjust-new'>Nuevo valor</label>
          <input
            id='adjust-new'
            inputMode='numeric'
            placeholder={String(stock)}
            value={adjustNewText}
            onChange={(e) => {
              setAdjustNewText(e.target.value)
            }}
          />
        </div>
        <div className='form-row'>
          <label htmlFor='adjust-note'>Motivo (opcional)</label>
          <input
            id='adjust-note'
            value={adjustNote}
            onChange={(e) => {
              setAdjustNote(e.target.value)
            }}
          />
        </div>
        <button
          type='button'
          className='btn-accent'
          onClick={() => {
            void addAdjustment()
          }}
        >
          Guardar ajuste
        </button>
      </section>

      <section className='card'>
        <h2>📏 Cambio a esta talla</h2>
        {isCurrent
          ? (
            <p className='muted'>Esta es la talla actual.</p>
            )
          : (
            <button
              type='button'
              className='btn-neutral'
              onClick={() => {
                void changeToThisSize()
              }}
            >
              Cambiar a esta talla
            </button>
            )}
      </section>

      <section className='card'>
        <h2>📏 Predicción</h2>
        {forecast === null || forecast === undefined
          ? (
            <p className='muted'>Sin talla actual que predecir.</p>
            )
          : forecast.status === 'NO_DATA'
            ? (
              <p className='muted'>Estamos aprendiendo el patrón de consumo.</p>
              )
            : (
              <>
                <p>
                  ≈ {forecast.dailyConsumption?.toFixed(1)} pañales/día ·{' '}
                  quedan ≈ {Math.round(forecast.daysRemaining ?? 0)} días
                </p>
                <p className='muted small'>
                  Agotamiento aprox.: {forecast.exhaustionDate !== null
                  ? formatLogicalDateEs(forecast.exhaustionDate)
                  : '—'} ·{' '}
                  {confidenceLabel(forecast) ?? 'sin datos suficientes'}
                  {forecast.variabilityHigh && ' · consumo irregular'}
                </p>
              </>
              )}
      </section>

      <section className='card'>
        <h2>🧷 Señales de talla pequeña</h2>
        <p className='muted small'>
          Marca lo que observes. Con una señal avisamos 21 días antes del
          cambio; con dos o más, 7.
        </p>
        {SIGNAL_DEFS.map(({ key, label }) => (
          <label key={key} className='check-row'>
            <input
              type='checkbox'
              checked={signals[key]}
              onChange={(e) => {
                writeSignal(baby.id, sizeId, key, e.target.checked)
                setSignals(readSignals(baby.id, sizeId))
              }}
            />
            {label}
          </label>
        ))}
      </section>

      <section className='card'>
        <h2>Últimos días</h2>
        <LastDays babyId={baby.id} />
      </section>

      {error && (
        <p role='alert' className='error'>
          {error}
        </p>
      )}
    </main>
  )
}

const SIGNAL_DEFS: Array<{ key: keyof TransitionSignals; label: string }> = [
  { key: 'leaks', label: 'Escapes frecuentes' },
  { key: 'tight', label: 'Le queda ajustado' },
  { key: 'marks', label: 'Le deja marcas' },
  { key: 'hardToClose', label: 'Cuesta cerrarlo' },
]

/** Average daily usage over the last `window` natural days (today excluded). */
/** Aggregated per baby (D-12): same basis as the prediction above. */
const LastDays = ({ babyId }: { babyId: string }) => {
  // Aggregated per baby (D-12): same basis as the prediction above.
  const rows = useLiveQuery(
    async () => {
      const usage = await liveUsage(db, babyId, 0)
      const byDay = usageByDay(usage)
      const now = Date.now()
      const today = logicalDate(now)
      const rows: Array<{ windowDays: number; average: number | null }> = []
      for (const windowDays of [7, 14]) {
        let total = 0
        let counted = 0
        for (let i = 1; i <= windowDays; i++) {
          const day = logicalDate(now - i * 86_400_000)
          const value = byDay.get(day)
          if (value !== undefined) {
            total += value
            counted++
          }
        }
        rows.push({
          windowDays,
          average: counted > 0 ? total / windowDays : null,
        })
      }
      void today
      return rows
    },
    [babyId]
  )

  if (rows === undefined) return null

  return (
    <ul className='last-days'>
      {rows.map((row) => (
        <li key={row.windowDays}>
          Últimos {String(row.windowDays)} días:{' '}
          {row.average === null
            ? (
              <span className='muted'>sin datos</span>
              )
            : (
              <>≈ {row.average.toFixed(1)}/día</>
              )}
        </li>
      ))}
    </ul>
  )
}
