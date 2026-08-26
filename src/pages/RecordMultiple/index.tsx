import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createMovement } from '../../../shared/factory.ts'
import type { Baby, UsageSource } from '../../../shared/types.ts'
import { db } from '../../db/index.ts'
import {
  useCurrentSize,
  useStockBySize,
} from '../../hooks'
import { getDeviceId } from '../../sync/device-id.ts'
import { uuid } from '../../lib/uuid.ts'
import { notifyWrite } from '../../sync/scheduler.ts'

const SIZES = [0, 1, 2, 3, 4, 5, 6] as const

/** Local datetime-local value → epoch ms interpreted in Europe/Madrid. */
const localInputToEpoch = (value: string): number | null => {
  if (value === '') return null
  const naive = Date.parse(`${value}:00Z`)
  if (Number.isNaN(naive)) return null
  // Correct by the zone offset so wall-clock time is preserved (D-07)
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(naive))
  const get = (type: string): number =>
    Number(formatted.find((p) => p.type === type)?.value ?? '0')
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  )
  return naive - (asUTC - Math.floor(naive / 1000) * 1000)
}

const nowForInput = (): string => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export const RecordMultiple = ({ baby }: { baby: Baby }) => {
  const navigate = useNavigate()
  const stocks = useStockBySize(baby.id)
  const currentSizeId = useCurrentSize(baby.id)

  const [quantity, setQuantity] = useState(1)
  const [sizeId, setSizeId] = useState<number | null>(null)
  const [when, setWhen] = useState(() => nowForInput())
  const [external, setExternal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveSize = sizeId ?? (typeof currentSizeId === 'number' ? currentSizeId : null)

  const register = async (): Promise<void> => {
    if (effectiveSize === null) {
      setError('No hay talla seleccionada')
      return
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError('La cantidad debe ser un entero ≥ 1')
      return
    }
    const occurredAt = localInputToEpoch(when) ?? Date.now()
    const now = Date.now()
    if (occurredAt > now + 60_000) {
      setError('La fecha no puede estar en el futuro')
      return
    }
    const usageSource: UsageSource = external ? 'EXTERNAL' : 'OWN_STOCK'
    const movement = createMovement(
      {
        id: uuid(),
        babyId: baby.id,
        sizeId: effectiveSize,
        deviceId: getDeviceId(),
        occurredAt,
        recordedAt: now,
      },
      { type: 'USAGE', usageSource, quantity }
    )
    await db.movements.add(movement)
    notifyWrite()
    void navigate('/')
  }

  return (
    <main className='page'>
      <h1>Registrar pañales</h1>

      <section className='card'>
        <h2>Cantidad</h2>
        <div className='stepper'>
          <button
            type='button'
            aria-label='Menos'
            onClick={() => {
              setQuantity(Math.max(1, quantity - 1))
            }}
          >
            −
          </button>
          <span aria-live='polite'>{quantity}</span>
          <button
            type='button'
            aria-label='Más'
            onClick={() => {
              setQuantity(quantity + 1)
            }}
          >
            +
          </button>
        </div>
      </section>

      <section className='card'>
        <fieldset className='size-grid-fieldset'>
          <legend>Talla</legend>
          <div className='size-grid'>
            {SIZES.map((size) => (
              <span key={size} className='radio-chip'>
                <input
                  type='radio'
                  id={`size-${String(size)}`}
                  name='size'
                  checked={effectiveSize === size}
                  onChange={() => {
                    setSizeId(size)
                  }}
                />
                <label htmlFor={`size-${String(size)}`}>{String(size)}</label>
              </span>
            ))}
          </div>
        </fieldset>
      </section>

      <section className='card'>
        <h2>Cuándo</h2>
        <input
          type='datetime-local'
          value={when}
          onChange={(e) => {
            setWhen(e.target.value)
          }}
        />
      </section>

      <label className='check-row'>
        <input
          type='checkbox'
          checked={external}
          onChange={(e) => {
            setExternal(e.target.checked)
          }}
        />
        No son nuestros (hospital, abuelos…)
      </label>

      {error && (
        <p role='alert' className='error'>
          {error}
        </p>
      )}

      <button
        type='button'
        className='primary big-action'
        disabled={effectiveSize === null || stocks === undefined}
        onClick={() => {
          void register()
        }}
      >
        Registrar
      </button>
    </main>
  )
}
