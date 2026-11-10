import type { CacotasDB } from '../db/index.ts'
import { BabyMismatchError } from './errors.ts'
import type { SyncBackend } from './backend.ts'
import type { BabyCursors } from './types.ts'
import { applyHouseholdSettings, getHouseholdSettings } from '../lib/settings.ts'
import { mergeDoseRecords } from '../../shared/health.ts'

const CURSOR_KEY = 'cacotas.syncCursors'
const LAST_SYNC_KEY = 'cacotas.lastSyncAt'

const cursorKey = (deviceId: string): string => `${CURSOR_KEY}:${deviceId}`

const readCursors = (deviceId: string): BabyCursors => {
  const raw = localStorage.getItem(cursorKey(deviceId))
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => Number.isInteger(value) && (value as number) >= 0)
    )
  } catch {
    return {}
  }
}

export const clearSyncState = (deviceId: string): void => {
  localStorage.removeItem(cursorKey(deviceId))
  localStorage.removeItem(LAST_SYNC_KEY)
}

export const lastSyncAt = (): number | null => {
  const raw = localStorage.getItem(LAST_SYNC_KEY)
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10)
  return Number.isInteger(parsed) ? parsed : null
}

export const runSync = async (
  db: CacotasDB,
  backend: SyncBackend,
  deviceId: string
): Promise<void> => {
  const cursors = readCursors(deviceId)
  let hasMore = true

  while (hasMore) {
    const pendingMovements = await db.movements.where('serverSeq').equals(0).toArray()
    const pendingWeights = await db.weights.where('serverSeq').equals(0).toArray()
    const pendingHeightRecords = await db.heightRecords.where('serverSeq').equals(0).toArray()
    const pendingTreatments = await db.treatments.where('serverSeq').equals(0).toArray()
    const pendingDoseRecords = await db.doseRecords.where('serverSeq').equals(0).toArray()
    const pendingAppointments = await db.appointments.where('serverSeq').equals(0).toArray()
    const localBaby = (await db.babies.toArray()).at(0)
    const localLocations = (await db.locations.toArray()).map((location) => {
      // Keep the wire shape stable even if an older sync stored the worker's
      // snake_case SQL row directly in IndexedDB.
      const legacy = location as typeof location & {
        reorder_point?: unknown
        created_at?: unknown
        updated_at?: unknown
        device_id?: unknown
      }
      const reorderPoint = Number.isInteger(location.reorderPoint) && location.reorderPoint >= 0
        ? location.reorderPoint
        : Number.isInteger(legacy.reorder_point) && (legacy.reorder_point as number) >= 0
          ? legacy.reorder_point as number
          : 10
      const createdAt = Number.isInteger(location.createdAt)
        ? location.createdAt
        : Number.isInteger(legacy.created_at)
          ? legacy.created_at as number
          : Date.now()
      const updatedAt = Number.isInteger(location.updatedAt)
        ? location.updatedAt
        : Number.isInteger(legacy.updated_at)
          ? legacy.updated_at as number
          : createdAt
      const normalizedDeviceId = typeof location.deviceId === 'string' && location.deviceId !== ''
        ? location.deviceId
        : typeof legacy.device_id === 'string' && legacy.device_id !== ''
          ? legacy.device_id
          : deviceId

      return {
        id: location.id,
        name: location.name,
        reorderPoint,
        createdAt,
        updatedAt,
        deviceId: normalizedDeviceId,
      }
    })

    const res = await backend.sync({
      deviceId,
      cursors,
      movements: pendingMovements,
      weights: pendingWeights,
      heightRecords: pendingHeightRecords,
      treatments: pendingTreatments,
      doseRecords: pendingDoseRecords,
      appointments: pendingAppointments,
      locations: localLocations,
      settings: getHouseholdSettings(deviceId),
      ...(localBaby !== undefined ? { baby: localBaby } : {}),
    })

    if (
      (localBaby !== undefined && res.babies.some((baby) => baby.id !== localBaby.id)) ||
      (localBaby !== undefined && res.movements.some((m) => m.babyId !== localBaby.id)) ||
      (localBaby !== undefined && res.weights.some((w) => w.babyId !== localBaby.id)) ||
      (localBaby !== undefined && (res.heightRecords ?? []).some((r) => r.babyId !== localBaby.id)) ||
      (localBaby !== undefined && (res.treatments ?? []).some((r) => r.babyId !== localBaby.id)) ||
      (localBaby !== undefined && (res.doseRecords ?? []).some((r) => r.babyId !== localBaby.id)) ||
      (localBaby !== undefined && (res.appointments ?? []).some((r) => r.babyId !== localBaby.id))
    ) {
      throw new BabyMismatchError()
    }

    if (res.settings !== undefined) applyHouseholdSettings(res.settings)

    await db.transaction(
      'rw',
      [db.movements, db.weights, db.heightRecords, db.babies, db.locations, db.treatments, db.doseRecords, db.appointments],
      async () => {
        await db.movements.bulkPut(res.movements)
        await db.weights.bulkPut(res.weights)
        await db.heightRecords.bulkPut(res.heightRecords ?? [])
        for (const row of res.treatments ?? []) {
          const mine = await db.treatments.get(row.id)
          if (mine === undefined || row.updatedAt > mine.updatedAt || (row.serverSeq > 0 && mine.serverSeq === 0)) await db.treatments.put(row)
        }
        for (const row of res.doseRecords ?? []) {
          const mine = await db.doseRecords.get(row.id)
          if (mine === undefined) {
            await db.doseRecords.put(row)
          } else {
            await db.doseRecords.put(mergeDoseRecords(mine, row))
          }
        }
        for (const row of res.appointments ?? []) {
          const mine = await db.appointments.get(row.id)
          if (mine === undefined || row.updatedAt > mine.updatedAt || (row.serverSeq > 0 && mine.serverSeq === 0)) await db.appointments.put(row)
        }
        for (const location of res.locations ?? []) {
          const mine = await db.locations.get(location.id)
          if (mine === undefined || location.updatedAt > mine.updatedAt) await db.locations.put(location)
        }
        for (const baby of res.babies) {
          const mine = await db.babies.get(baby.id)
          if (mine === undefined || baby.updatedAt > mine.updatedAt) await db.babies.put(baby)
        }
        if (res.baby !== undefined) {
          const mine = await db.babies.get(res.baby.id)
          if (mine === undefined || res.baby.updatedAt > mine.updatedAt) await db.babies.put(res.baby)
        }
      }
    )

    const receivedCursors: BabyCursors = { ...cursors }
    for (const row of [...res.movements, ...res.weights, ...(res.heightRecords ?? [])]) {
      receivedCursors[row.babyId] = Math.max(receivedCursors[row.babyId] ?? 0, row.serverSeq)
    }
    for (const [babyId, cursor] of Object.entries(receivedCursors)) {
      cursors[babyId] = Math.max(cursors[babyId] ?? 0, cursor)
    }
    hasMore = Object.values(res.hasMore).some(Boolean)
  }

  localStorage.setItem(cursorKey(deviceId), JSON.stringify(cursors))
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
}
