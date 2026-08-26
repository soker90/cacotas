import type { CacotasDB } from '../db/index.ts'
import { BabyMismatchError } from './errors.ts'
import type { SyncBackend } from './backend.ts'

const CURSOR_KEY = 'cacotas.syncCursor'
const LAST_SYNC_KEY = 'cacotas.lastSyncAt'

const readCursor = (): number => {
  const raw = localStorage.getItem(CURSOR_KEY)
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

/** Discreet "synced X ago" indicator source (§9.3) — never an error. */
export const lastSyncAt = (): number | null => {
  const raw = localStorage.getItem(LAST_SYNC_KEY)
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10)
  return Number.isInteger(parsed) ? parsed : null
}

/**
 * One full sync round: upload pending rows, download everything past the
 * cursor (paginating as needed). Throws on failure; the cursor is only
 * persisted after a fully successful round.
 */
export const runSync = async (
  db: CacotasDB,
  backend: SyncBackend,
  deviceId: string
): Promise<void> => {
  let since = readCursor()
  let hasMore = true

  while (hasMore) {
    // Re-read pending rows every iteration: the echo of our own uploads
    // (with the server-assigned serverSeq) updates them between pages.
    const pendingMovements = await db.movements
      .where('serverSeq')
      .equals(0)
      .toArray()
    const pendingWeights = await db.weights
      .where('serverSeq')
      .equals(0)
      .toArray()
    const localBaby = (await db.babies.toArray()).at(0)

    const res = await backend.sync({
      deviceId,
      since,
      movements: pendingMovements,
      weights: pendingWeights,
      ...(localBaby !== undefined ? { baby: localBaby } : {}),
    })

    // Safeguard §9.7: never mix two babies. Abort before writing anything.
    if (
      (res.baby !== undefined &&
        localBaby !== undefined &&
        res.baby.id !== localBaby.id) ||
      (localBaby !== undefined &&
        res.movements.some((m) => m.babyId !== localBaby.id))
    ) {
      throw new BabyMismatchError()
    }

    await db.transaction(
      'rw',
      db.movements,
      db.weights,
      db.babies,
      async () => {
        // 1. Remote rows first — bulkPut is idempotent by id.
        await db.movements.bulkPut(res.movements)
        await db.weights.bulkPut(res.weights)

        // Baby LWW client-side mirror of §9.2.
        if (res.baby !== undefined) {
          const mine = await db.babies.get(res.baby.id)
          if (mine === undefined || res.baby.updatedAt > mine.updatedAt) {
            await db.babies.put(res.baby)
          }
        }

        // 2. Movements confirmed in `accepted` but NOT echoed back in this
        //    page keep serverSeq = 0: nothing is falsely marked, so the next
        //    round re-uploads them and D-17 idempotency absorbs it.
      }
    )

    since =
      res.movements.length > 0
        ? Math.max(...res.movements.map((m) => m.serverSeq))
        : since
    hasMore = res.hasMore
  }

  localStorage.setItem(CURSOR_KEY, String(since))
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
}
