import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createMovement } from '../../../shared/factory.ts'
import type { Baby } from '../../../shared/types.ts'
import { db } from '../../db/index.ts'
import { useCurrentSize, useStockBySize } from '../../hooks'
import { getDeviceId } from '../../sync/device-id.ts'
import { uuid } from '../../lib/uuid.ts'
import { notifyWrite } from '../../sync/scheduler.ts'
import { defaultLocationId, getActiveLocationId, resolveActiveLocationId } from '../../lib/locations.ts'
import { transferStock } from '../../lib/transfers.ts'

const quickAdjust = async (babyId: string, sizeId: number, delta: number, locationId?: string): Promise<void> => {
  const now = Date.now()
  const movement = createMovement(
    { id: uuid(), babyId, sizeId, ...(locationId !== undefined ? { locationId } : {}), deviceId: getDeviceId(), occurredAt: now, recordedAt: now },
    { type: 'ADJUSTMENT', delta }
  )
  await db.movements.add(movement)
  notifyWrite()
}

export const Inventory = ({ baby }: { baby: Baby }) => {
  const sizes = useLiveQuery(() => db.sizes.toArray())
  const locations = useLiveQuery(() => db.locations.toArray())
  const storedLocationId = getActiveLocationId(defaultLocationId(baby.id))
  const locationId = locations === undefined
    ? storedLocationId
    : resolveActiveLocationId(storedLocationId, defaultLocationId(baby.id), locations)
  const stocks = useStockBySize(baby.id, locationId)
  const currentSizeId = useCurrentSize(baby.id)
  const activeLocation = locations?.find((location) => location.id === locationId)
  const [transferSizeId, setTransferSizeId] = useState<number | null>(null)
  const [transferQuantity, setTransferQuantity] = useState('1')
  const [transferTo, setTransferTo] = useState('')
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferStatus, setTransferStatus] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const destinationLocations = locations?.filter((location) => location.id !== locationId) ?? []

  const submitTransfer = (): void => {
    if (locationId === undefined || transferSizeId === null || isSubmitting) return
    const quantity = Number(transferQuantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      setTransferError('La cantidad debe ser un entero ≥ 1')
      return
    }
    if (transferTo === '') {
      setTransferError('Elige una ubicación de destino')
      return
    }
    setTransferError(null)
    setTransferStatus(null)
    setIsSubmitting(true)
    void transferStock(baby.id, transferSizeId, quantity, locationId, transferTo)
      .then(() => {
        setTransferSizeId(null)
        setTransferQuantity('1')
        setTransferTo('')
        setTransferStatus('Transferencia registrada')
      })
      .catch((error: unknown) => {
        setTransferError(error instanceof Error ? error.message : 'No se pudo transferir')
      })
      .finally(() => {
        setIsSubmitting(false)
      })
  }

  if (sizes === undefined || stocks === undefined) return <main className='loading'>…</main>

  return (
    <main className='page'>
      <h1>Inventario</h1>
      {activeLocation !== undefined && <p className='muted'>📍 {activeLocation.name}</p>}
      {currentSizeId !== null && currentSizeId !== undefined && (
        <p className='muted'>Talla actual: Talla {String(currentSizeId)}</p>
      )}

      {destinationLocations.length > 0 && (
        <section className='card'>
          <h2>Mover pañales</h2>
          <p className='muted small'>
            Mueve stock desde {activeLocation?.name ?? 'esta ubicación'} a otra ubicación. No cuenta como consumo.
          </p>
          <div className='form-row'>
            <label htmlFor='transfer-size'>Talla</label>
            <select
              id='transfer-size'
              value={transferSizeId === null ? '' : String(transferSizeId)}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10)
                setTransferSizeId(Number.isInteger(value) ? value : null)
                setTransferError(null)
                setTransferStatus(null)
              }}
            >
              <option value=''>Selecciona una talla</option>
              {sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
            </select>

            <label htmlFor='transfer-quantity'>Cantidad</label>
            <input
              id='transfer-quantity'
              inputMode='numeric'
              min='1'
              value={transferQuantity}
              onChange={(event) => setTransferQuantity(event.target.value)}
            />

            <label htmlFor='transfer-to'>Destino</label>
            <select
              id='transfer-to'
              value={transferTo}
              onChange={(event) => {
                setTransferTo(event.target.value)
                setTransferError(null)
                setTransferStatus(null)
              }}
            >
              <option value=''>Selecciona destino</option>
              {destinationLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>

            <button
              type='button'
              className='primary'
              disabled={isSubmitting || transferSizeId === null || transferTo === ''}
              onClick={submitTransfer}
            >
              {isSubmitting ? 'Moviendo…' : 'Mover pañales'}
            </button>
            {transferError !== null && <p className='warn' role='alert'>{transferError}</p>}
            {transferStatus !== null && <p className='muted' role='status'>{transferStatus}</p>}
          </div>
        </section>
      )}

      <ul className='inventory-list'>
        {sizes.map((size) => {
          const stock = stocks.get(size.id) ?? 0
          return (
            <li key={size.id} className={stock < 0 ? 'inventory-row warn' : 'inventory-row'}>
              <Link to={'/inventory/' + String(size.id)} className='size-link' aria-label={'Ver detalle de ' + size.name}>
                <strong>{size.name}</strong>
                <span className='stock-value'>{stock} pañales{stock < 0 && ' · revisa el inventario'}</span>
                <span className='chevron' aria-hidden='true'>›</span>
              </Link>
              <div className='quick-adjust' aria-label={'Ajuste rápido ' + size.name}>
                <button type='button' aria-label={'Quitar uno de ' + size.name} onClick={() => { void quickAdjust(baby.id, size.id, -1, locationId) }}>−</button>
                <span>{stock}</span>
                <button type='button' aria-label={'Añadir uno a ' + size.name} onClick={() => { void quickAdjust(baby.id, size.id, +1, locationId) }}>+</button>
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
