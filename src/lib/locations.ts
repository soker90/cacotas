import { db } from '../db/index.ts'
import type { Location, UUID } from '../../shared/types.ts'
import { getDeviceId } from '../sync/device-id.ts'
import { uuid } from './uuid.ts'

const ACTIVE_LOCATION_KEY = 'cacotas.activeLocationId'

export const defaultLocationId = (babyId: UUID): UUID => `default:${babyId}`

export const ensureDefaultLocation = async (babyId: UUID): Promise<Location> => {
  const id = defaultLocationId(babyId)
  const existing = await db.locations.get(id)
  if (existing !== undefined) return existing
  const now = Date.now()
  const location: Location = {
    id,
    name: 'Casa',
    reorderPoint: 40,
    createdAt: now,
    updatedAt: now,
    deviceId: getDeviceId(),
  }
  await db.locations.put(location)
  return location
}

export const getActiveLocationId = (fallback: UUID): UUID => {
  const stored = localStorage.getItem(ACTIVE_LOCATION_KEY)
  return stored ?? fallback
}

export const setActiveLocationId = (locationId: UUID): void => {
  localStorage.setItem(ACTIVE_LOCATION_KEY, locationId)
}

export const createLocation = async (name: string, reorderPoint = 10): Promise<Location> => {
  const now = Date.now()
  const location: Location = {
    id: uuid(),
    name: name.trim(),
    reorderPoint,
    createdAt: now,
    updatedAt: now,
    deviceId: getDeviceId(),
  }
  await db.locations.add(location)
  return location
}
