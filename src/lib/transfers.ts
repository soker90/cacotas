import { createMovement } from '../../shared/factory.ts'
import type { UUID } from '../../shared/types.ts'
import { db } from '../db/index.ts'
import { getDeviceId } from '../sync/device-id.ts'
import { uuid } from './uuid.ts'
import { notifyWrite } from '../sync/scheduler.ts'

export const transferStock = async (
  babyId: UUID,
  sizeId: number,
  quantity: number,
  fromLocationId: UUID,
  toLocationId: UUID
): Promise<void> => {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('La cantidad debe ser un entero ≥ 1')
  }
  if (fromLocationId === toLocationId) {
    throw new Error('El origen y el destino deben ser distintos')
  }

  const now = Date.now()
  const transferId = uuid()
  const common = {
    babyId,
    sizeId,
    deviceId: getDeviceId(),
    occurredAt: now,
    recordedAt: now,
  } as const

  const outgoing = createMovement(
    {
      ...common,
      id: uuid(),
      locationId: fromLocationId,
      note: `Transferencia ${transferId}`,
    },
    { type: 'ADJUSTMENT', delta: -quantity }
  )
  const incoming = createMovement(
    {
      ...common,
      id: uuid(),
      locationId: toLocationId,
      note: `Transferencia ${transferId}`,
    },
    { type: 'ADJUSTMENT', delta: quantity }
  )

  await db.transaction('rw', db.movements, async () => {
    await db.movements.bulkAdd([outgoing, incoming])
  })
  notifyWrite()
}
