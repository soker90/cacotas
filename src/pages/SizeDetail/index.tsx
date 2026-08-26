import { useState } from 'react'
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { createMovement } from '../../../shared/factory.ts'
import type { Baby } from '../../../shared/types.ts'
import { db } from '../../db/index.ts'
import {
  useCurrentSize,
  useStockBySize,
} from '../../hooks'
import { getDeviceId } from '../../sync/device-id.ts'
import { uuid } from '../../lib/uuid.ts'

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

      {error && (
        <p role='alert' className='error'>
          {error}
        </p>
      )}

      <p className='muted small'>
        Consumo y días restantes llegarán con el motor de predicciones.
      </p>
    </main>
  )
}
