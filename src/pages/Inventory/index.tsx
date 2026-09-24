import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { createMovement } from '../../../shared/factory.ts'
import type { Baby } from '../../../shared/types.ts'
import { db } from '../../db/index.ts'
import { stockBySize } from '../../db/derive.ts'
import { useCurrentSize, useStockBySize } from '../../hooks'
import { getDeviceId } from '../../sync/device-id.ts'
import { uuid } from '../../lib/uuid.ts'
import { notifyWrite } from '../../sync/scheduler.ts'
import { defaultLocationId, getActiveLocationId, resolveActiveLocationId } from '../../lib/locations.ts'
import { transferStock } from '../../lib/transfers.ts'

type InventoryView = 'current' | 'all'

const quickAdjust = async (babyId: string, sizeId: number, delta: number, locationId: string): Promise<void> => {
  const now = Date.now()
  const movement = createMovement(
    { id: uuid(), babyId, sizeId, locationId, deviceId: getDeviceId(), occurredAt: now, recordedAt: now },
    { type: 'ADJUSTMENT', delta }
  )
  await db.movements.add(movement)
  notifyWrite()
}

export const Inventory = ({ baby }: { baby: Baby }) => {
  const sizes = useLiveQuery(() => db.sizes.toArray())
  const locations = useLiveQuery(() => db.locations.toArray())
  const [view, setView] = useState<InventoryView>('current')
  const [transferFrom, setTransferFrom] = useState('')
  const [transferSizeId, setTransferSizeId] = useState<number | null>(null)
  const [transferQuantity, setTransferQuantity] = useState('1')
  const [transferTo, setTransferTo] = useState('')
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferStatus, setTransferStatus] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const storedLocationId = getActiveLocationId(defaultLocationId(baby.id))
  const locationId = locations === undefined
    ? storedLocationId
    : resolveActiveLocationId(storedLocationId, defaultLocationId(baby.id), locations)
  const stocks = useStockBySize(baby.id, view === 'current' ? locationId : undefined)
  const locationStocks = useLiveQuery(async () => {
    const result = new Map<string, Map<number, number>>()
    if (locations === undefined) return result
    await Promise.all(locations.map(async (location) => {
      result.set(location.id, await stockBySize(db, baby.id, location.id))
    }))
    return result
  }, [baby.id, locations])
  const currentSizeId = useCurrentSize(baby.id)
  const activeLocation = locations?.find((location) => location.id === locationId)
  const sourceLocationId = transferFrom !== '' ? transferFrom : locationId
  const destinationLocations = locations?.filter((location) => location.id !== sourceLocationId) ?? []

  const submitTransfer = (): void => {
    if (sourceLocationId === undefined || transferSizeId === null || isSubmitting) return
    const quantity = Number(transferQuantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      setTransferError('La cantidad debe ser un entero ≥ 1')
      return
    }
    if (transferTo === '') {
      setTransferError('Elige una ubicación de destino')
      return
    }
    const sourceStock = locationStocks?.get(sourceLocationId)?.get(transferSizeId) ?? 0
    if (quantity > sourceStock) {
      setTransferError(`Solo hay ${String(sourceStock)} pañales de esta talla en el origen`)
      return
    }
    setTransferError(null)
    setTransferStatus(null)
    setIsSubmitting(true)
    void transferStock(baby.id, transferSizeId, quantity, sourceLocationId, transferTo)
      .then(() => {
        setTransferSizeId(null)
        setTransferQuantity('1')
        setTransferTo('')
        setTransferStatus('Transferencia registrada')
      })
      .catch((error: unknown) => {
        setTransferError(error instanceof Error ? error.message : 'No se pudo transferir')
      })
      .finally(() => setIsSubmitting(false))
  }

  if (sizes === undefined || stocks === undefined || locations === undefined || locationStocks === undefined) {
    return <main className='loading'>…</main>
  }

  return (
    <main className='page'>
      <div className='inventory-heading'>
        <div>
          <h1>Inventario</h1>
          {view === 'current' && activeLocation !== undefined && <p className='muted'>📍 {activeLocation.name}</p>}
        </div>
        {currentSizeId !== null && currentSizeId !== undefined && (
          <span className='inventory-current-size'>Talla {String(currentSizeId)}</span>
        )}
      </div>

      <div className='inventory-view-toggle' role='tablist' aria-label='Vista del inventario'>
        <button type='button' role='tab' aria-selected={view === 'current'} className={view === 'current' ? 'selected' : ''} onClick={() => setView('current')}>
          Esta ubicación
        </button>
        <button type='button' role='tab' aria-selected={view === 'all'} className={view === 'all' ? 'selected' : ''} onClick={() => setView('all')}>
          Todas las ubicaciones
        </button>
      </div>

      {locations.length > 1 && (
        <section className='card transfer-card'>
          <div className='transfer-title'>
            <div>
              <h2>↔️ Mover pañales</h2>
              <p className='muted small'>Pasa stock entre ubicaciones sin contarlo como consumo.</p>
            </div>
          </div>

          <div className='transfer-route'>
            <label>
              <span>Desde</span>
              <select aria-label='Ubicación de origen' value={sourceLocationId} onChange={(event) => {
                setTransferFrom(event.target.value)
                setTransferTo('')
                setTransferError(null)
                setTransferStatus(null)
              }}>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <span className='transfer-arrow' aria-hidden='true'>→</span>
            <label>
              <span>Hasta</span>
              <select aria-label='Ubicación de destino' value={transferTo} onChange={(event) => {
                setTransferTo(event.target.value)
                setTransferError(null)
                setTransferStatus(null)
              }}>
                <option value=''>Elige destino</option>
                {destinationLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
          </div>

          <div className='transfer-fields'>
            <label>
              <span>Talla</span>
              <select value={transferSizeId === null ? '' : String(transferSizeId)} onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10)
                setTransferSizeId(Number.isInteger(value) ? value : null)
                setTransferError(null)
                setTransferStatus(null)
              }}>
                <option value=''>Elige talla</option>
                {sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}
              </select>
            </label>
            <label className='transfer-quantity'>
              <span>Cantidad</span>
              <input type='number' inputMode='numeric' min='1' step='1' value={transferQuantity} onChange={(event) => setTransferQuantity(event.target.value)} />
            </label>
          </div>

          {transferSizeId !== null && sourceLocationId !== undefined && (
            <p className='transfer-stock-hint muted small'>
              Disponible en origen: <strong>{locationStocks.get(sourceLocationId)?.get(transferSizeId) ?? 0}</strong>
            </p>
          )}

          <button type='button' className='primary' disabled={isSubmitting || transferSizeId === null || transferTo === '' || sourceLocationId === undefined} onClick={submitTransfer}>
            {isSubmitting ? 'Moviendo…' : 'Mover pañales'}
          </button>
          {transferError !== null && <p className='warn' role='alert'>{transferError}</p>}
          {transferStatus !== null && <p className='transfer-success' role='status'>{transferStatus}</p>}
        </section>
      )}

      {view === 'all' && <p className='muted small inventory-helper'>Aquí puedes consultar el total y ajustar directamente el stock de cada ubicación.</p>}

      <ul className='inventory-list'>
        {sizes.map((size) => {
          const stock = stocks.get(size.id) ?? 0
          const isCurrent = currentSizeId === size.id
          return (
            <li key={size.id} className={stock < 0 ? 'inventory-row warn' : 'inventory-row'}>
              <div className='inventory-main'>
                <Link to={'/inventory/' + String(size.id)} className='size-link' aria-label={'Ver detalle de ' + size.name}>
                  <strong>{size.name}</strong>
                  <span className='stock-value'>{stock} pañales{isCurrent && ' · talla actual'}{stock < 0 && ' · revisa el inventario'}</span>
                  <span className='chevron' aria-hidden='true'>›</span>
                </Link>
                {view === 'current' && (
                  <div className='quick-adjust' aria-label={'Ajuste rápido ' + size.name}>
                    <button type='button' aria-label={'Quitar uno de ' + size.name} onClick={() => { void quickAdjust(baby.id, size.id, -1, locationId) }}>−</button>
                    <span>{stock}</span>
                    <button type='button' aria-label={'Añadir uno a ' + size.name} onClick={() => { void quickAdjust(baby.id, size.id, +1, locationId) }}>+</button>
                  </div>
                )}
              </div>

              {view === 'all' && (
                <div className='inventory-locations'>
                  {locations.map((location) => {
                    const locationStock = locationStocks.get(location.id)?.get(size.id) ?? 0
                    return (
                      <div key={location.id} className='inventory-location-row'>
                        <span className='inventory-location-name'>📍 {location.name}</span>
                        <div className='quick-adjust' aria-label={'Ajuste de ' + size.name + ' en ' + location.name}>
                          <button type='button' aria-label={'Quitar uno de ' + size.name + ' en ' + location.name} onClick={() => { void quickAdjust(baby.id, size.id, -1, location.id) }}>−</button>
                          <span>{locationStock}</span>
                          <button type='button' aria-label={'Añadir uno a ' + size.name + ' en ' + location.name} onClick={() => { void quickAdjust(baby.id, size.id, +1, location.id) }}>+</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </main>
  )
}
