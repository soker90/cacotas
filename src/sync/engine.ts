import type { CacotasDB } from '../db/index.ts'
import { BabyMismatchError } from './errors.ts'
import type { SyncBackend } from './backend.ts'
import type { BabyCursors } from './types.ts'

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
    const localBaby = (await db.babies.toArray()).at(0)
    const localLocations = await db.locations.toArray()

    const res = await backend.sync({
      deviceId,
      cursors,
      movements: pendingMovements,
      weights: pendingWeights,
      locations: localLocations,
      ...(localBaby !== undefined ? { baby: localBaby } : {}),
    })

    if (
      (localBaby !== undefined && res.babies.some((baby) => baby.id !== localBaby.id)) ||
      (localBaby !== undefined && res.movements.some((m) => m.babyId !== localBaby.id)) ||
      (localBaby !== undefined && res.weights.some((w) => w.babyId !== localBaby.id))
    ) {
      throw new BabyMismatchError()
    }

    await db.transaction(
      'rw', db.movements, db.weights, db.babies, db.locations,
      async () => {
        await db.movements.bulkPut(res.movements)
        await db.weights.bulkPut(res.weights)
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

    for (const [babyId, cursor] of Object.entries(res.cursors)) {
      cursors[babyId] = Math.max(cursors[babyId] ?? 0, cursor)
    }
    hasMore = Object.values(res.hasMore).some(Boolean)
  }

  localStorage.setItem(cursorKey(deviceId), JSON.stringify(cursors))
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
}
