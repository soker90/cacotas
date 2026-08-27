import 'fake-indexeddb/auto'

// Minimal localStorage stub: the sync engine persists its cursor there and
// vitest's node environment has no storage implementation.
class MemoryStorage {
  #map = new Map<string, string>()
  getItem (key: string): string | null {
    return this.#map.get(key) ?? null
  }

  setItem (key: string, value: string): void {
    this.#map.set(key, String(value))
  }

  removeItem (key: string): void {
    this.#map.delete(key)
  }

  clear (): void {
    this.#map.clear()
  }
}
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
  })
}

import { beforeEach, describe, expect, it } from 'vitest'
import { createMovement } from '../shared/factory.ts'
import type { Baby, Movement } from '../shared/types.ts'
import { stockBySize } from '../src/db/derive.ts'
import { CacotasDB } from '../src/db/index.ts'
import { runSync } from '../src/sync/engine.ts'
import { nextDelayMs } from '../src/sync/scheduler.ts'
import {
  FakeSyncBackend,
} from '../src/sync/fake-backend.ts'

let counter = 0
const uid = (): string => `sync-${(counter++).toString().padStart(5, '0')}`

const baby = (name: string): Baby => ({
  id: 'baby-shared',
  name,
  zoneId: 'Europe/Madrid',
  createdAt: 1_000,
  updatedAt: 1_000,
  serverSeq: 0,
})

const usage = (babyId: string, quantity = 1): Movement =>
  createMovement(
    {
      id: uid(),
      babyId,
      sizeId: 2,
      deviceId: 'device-x',
      occurredAt: Date.now(),
      recordedAt: Date.now() + 1,
    },
    { type: 'USAGE', usageSource: 'OWN_STOCK', quantity }
  )

const purchase = (babyId: string, quantity: number): Movement =>
  createMovement(
    {
      id: uid(),
      babyId,
      sizeId: 2,
      deviceId: 'device-x',
      occurredAt: Date.now(),
      recordedAt: Date.now() + 1,
    },
    { type: 'PURCHASE', quantity }
  )

const makeDb = (): CacotasDB => new CacotasDB(`synctest-${uid()}`)

const seedBaby = async (database: CacotasDB): Promise<void> => {
  await database.babies.put(baby('Mateo'))
}

describe('sincronización (issue #4)', () => {
  let dbA: CacotasDB
  let dbB: CacotasDB
  let backend: FakeSyncBackend

  beforeEach(async () => {
    dbA = makeDb()
    dbB = makeDb()
    backend = new FakeSyncBackend()
    localStorage.clear()
    await seedBaby(dbA)
    await seedBaby(dbB)
  })

  it('two devices register offline → both sync → same stock on both', async () => {
    await dbA.movements.add(purchase('baby-shared', 84))
    await dbB.movements.add(usage('baby-shared', 1))

    await runSync(dbA, backend, 'device-a')
    await runSync(dbB, backend, 'device-b')
    // A second round pulls whatever the other device uploaded meanwhile
    await runSync(dbA, backend, 'device-a')

    const stockA = (await stockBySize(dbA, 'baby-shared')).get(2)
    const stockB = (await stockBySize(dbB, 'baby-shared')).get(2)
    expect(stockA).toBe(83)
    expect(stockB).toBe(stockA)

    // And a second round converges the remaining pending rows
    await runSync(dbA, backend, 'device-a')
    expect(await dbA.movements.count()).toBe(await dbB.movements.count())
  })

  it('resending the same movement does not duplicate (D-17)', async () => {
    const movement = purchase('baby-shared', 30)
    await dbA.movements.add(movement)

    await runSync(dbA, backend, 'device-a')
    // Simulate a cut connection right after upload: same payload again
    await dbA.movements.put({ ...movement, serverSeq: 0 })
    await runSync(dbA, backend, 'device-a')

    const remote = [...backend.movements.values()].filter(
      (m) => m.id === movement.id
    )
    expect(remote).toHaveLength(1)
    expect(await stockOf(dbA)).toBe(30)
  })

  it('a half-processed response marks nothing → retry recovers it', async () => {
    const movement = purchase('baby-shared', 60)
    await dbA.movements.add(movement)

    // Server accepts but its download section "gets lost" (no echo back)
    class HalfBackend extends FakeSyncBackend {
      override async sync (req: Parameters<FakeSyncBackend['sync']>[0]) {
        const res = await super.sync(req)
        return { ...res, movements: [], hasMore: false }
      }
    }
    const half = new HalfBackend()
    await runSync(dbA, half, 'device-a')

    // Nothing was falsely marked: still pending for the next round
    const stillPending = await dbA.movements
      .where('serverSeq')
      .equals(0)
      .toArray()
    expect(stillPending.map((m) => m.id)).toEqual([movement.id])

    // Retry against a healthy backend recovers everything
    await runSync(dbA, backend, 'device-a')
    expect(await stockOf(dbA)).toBe(60)
    const after = await dbA.movements.get(movement.id)
    expect(after?.serverSeq).not.toBe(0)
  })

  it('pagination: 600 rows are downloaded with no gaps', async () => {
    for (let i = 0; i < 600; i++) {
      backend.pushRemote({
        ...purchase('baby-shared', 1),
        id: `remote-${String(i).padStart(4, '0')}`,
        serverSeq: 0,
      })
    }

    await runSync(dbB, backend, 'device-b')

    expect(await dbB.movements.count()).toBe(600)
    // Every seq from 1..600 is present exactly once — no skipped pages
    const seqs = (await dbB.movements.toArray())
      .map((m) => m.serverSeq)
      .sort((a, b) => a - b)
    expect(seqs).toHaveLength(600)
    expect(seqs[0]).toBe(1)
    expect(seqs.at(-1)).toBe(600)
  })

  it('an UNDO arriving before its original ends with correct stock', async () => {
    const originalId = uid()
    // The server receives the UNDO first…
    backend.pushRemote({
      id: `undo-${originalId}`,
      babyId: 'baby-shared',
      sizeId: 2,
      type: 'UNDO',
      undoesMovementId: originalId,
      quantity: 60,
      delta: -60,
      occurredAt: Date.now(),
      recordedAt: Date.now() + 1,
      deviceId: 'other-device',
      serverSeq: 0,
    })
    // …and the original afterwards. Arrival order must not matter.
    backend.pushRemote({
      ...purchase('baby-shared', 60),
      id: originalId,
      serverSeq: 0,
    })

    await dbB.movements.add(mov({ type: 'INITIAL', quantity: 84 }))
    await runSync(dbB, backend, 'device-b')

    expect(await stockOf(dbB)).toBe(84)
  })
})

// ── helpers ──────────────────────────────────────────────
const stockOf = async (database: CacotasDB): Promise<number> =>
  (await stockBySize(database, 'baby-shared')).get(2) ?? 0

const mov = (opts: { type: Movement['type']; quantity: number }): Movement =>
  opts.type === 'INITIAL'
    ? createMovement(
      {
        id: uid(),
        babyId: 'baby-shared',
        sizeId: 2,
        deviceId: 'device-b',
        occurredAt: Date.now(),
        recordedAt: Date.now() + 1,
      },
      { type: 'INITIAL', quantity: opts.quantity }
    )
    : purchase('baby-shared', opts.quantity)

describe('nextDelayMs — scheduler retry intervals', () => {
  it('no backoff → the periodic interval', () => {
    expect(nextDelayMs(0)).toBe(5 * 60_000)
  })

  it('after a transient failure → the backoff interval, not 5 min', () => {
    expect(nextDelayMs(60_000)).toBe(60_000)
    expect(nextDelayMs(30 * 60_000)).toBe(30 * 60_000)
  })
})
