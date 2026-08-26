import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createMovement } from '../../../shared/factory.ts'
import type { Baby } from '../../../shared/types.ts'
import { db } from '../../db/index.ts'
import {
  useCurrentSize,
  useStockBySize,
} from '../../hooks'
import { getDeviceId } from '../../sync/device-id.ts'
import { uuid } from '../../lib/uuid.ts'
import { notifyWrite } from '../../sync/scheduler.ts'

/** Quick inventory correction: ±1 as an ADJUSTMENT difference. */
const quickAdjust = async (
  babyId: string,
  sizeId: number,
  delta: number
): Promise<void> => {
  const now = Date.now()
  const movement = createMovement(
    {
      id: uuid(),
      babyId,
      sizeId,
      deviceId: getDeviceId(),
      occurredAt: now,
      recordedAt: now,
    },
    { type: 'ADJUSTMENT', delta }
  )
  await db.movements.add(movement)
  notifyWrite()
}

export const Inventory = ({ baby }: { baby: Baby }) => {
  const sizes = useLiveQuery(() => db.sizes.toArray())
  const stocks = useStockBySize(baby.id)
  const currentSizeId = useCurrentSize(baby.id)

  if (sizes === undefined || stocks === undefined) {
    return <main className='loading'>…</main>
  }

  return (
    <main className='page'>
      <h1>Inventario</h1>

      {currentSizeId !== null && currentSizeId !== undefined && (
        <p className='muted'>
          Talla actual: Talla {String(currentSizeId)}
        </p>
      )}

      <ul className='inventory-list'>
        {sizes.map((size) => {
          const stock = stocks.get(size.id) ?? 0
          return (
            <li
              key={size.id}
              className={stock < 0 ? 'inventory-row warn' : 'inventory-row'}
            >
              <Link
                to={`/inventory/${size.id}`}
                className='size-link'
                aria-label={`Ver detalle de ${size.name}`}
              >
                <strong>{size.name}</strong>
                <span className='stock-value'>
                  {stock} pañales
                  {stock < 0 && ' · revisa el inventario'}
                </span>
                <span className='chevron' aria-hidden='true'>
                  ›
                </span>
              </Link>
              <div className='quick-adjust' aria-label={`Ajuste rápido ${size.name}`}>
                <button
                  type='button'
                  aria-label={`Quitar uno de ${size.name}`}
                  onClick={() => {
                    void quickAdjust(baby.id, size.id, -1)
                  }}
                >
                  −
                </button>
                <span>{stock}</span>
                <button
                  type='button'
                  aria-label={`Añadir uno a ${size.name}`}
                  onClick={() => {
                    void quickAdjust(baby.id, size.id, +1)
                  }}
                >
                  +
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
