import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMovement } from '../shared/factory.ts'
import { DODOT_SIZES } from '../shared/transition.ts'
import type { DiaperSize, Movement, WeightRecord } from '../shared/types.ts'
import { currentSize, liveUsage, stockBySize } from '../src/db/derive.ts'
import { CacotasDB, seedSizes } from '../src/db/index.ts'

let n = 0
const uid = () => `id-${(n++).toString().padStart(4, '0')}`

const BABY = 'baby-1'

const makeDb = (): CacotasDB => {
  return new CacotasDB(`test-${uid()}`)
}

interface MovOptions {
  type: Movement['type'];
  sizeId?: number;
  quantity?: number;
  usageSource?: Movement['usageSource'];
  occurredAt?: number;
  original?: Movement;
}

const mov = (opts: MovOptions): Movement => {
  return createMovement(
    {
      id: uid(),
      babyId: BABY,
      sizeId: opts.sizeId ?? 2,
      deviceId: 'device-test',
      occurredAt: opts.occurredAt ?? Date.now(),
      recordedAt: (opts.occurredAt ?? Date.now()) + 1,
    },
    opts.type === 'USAGE'
      ? {
          type: 'USAGE',
          usageSource: opts.usageSource ?? 'OWN_STOCK',
          quantity: opts.quantity ?? 1,
        }
      : opts.type === 'PURCHASE'
        ? { type: 'PURCHASE', quantity: opts.quantity ?? 10 }
        : opts.type === 'INITIAL'
          ? { type: 'INITIAL', quantity: opts.quantity ?? 50 }
          : opts.type === 'UNDO'
            ? { type: 'UNDO', original: opts.original as Movement }
            : { type: 'SIZE_CHANGE' }
  )
}

let db: CacotasDB
beforeEach(() => {
  db = makeDb()
})

describe('seedSizes', () => {
  it('seeds sizes 0-7 with the full Dodot data, once', async () => {
    await seedSizes(db)
    const sizes = await db.sizes.toArray()
    expect(sizes.map((s) => s.id).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    for (const seed of DODOT_SIZES) {
      const row = sizes.find((s) => s.id === seed.id)
      expect(row).toEqual(seed)
    }

    // Second call must not duplicate
    await seedSizes(db)
    expect(await db.sizes.count()).toBe(8)
  })
})

// ── Migration v1 → v2 (SPEC.md §4.4 / §15) ───────────────────────────────

/** The schema as phase 1 shipped it — sizes 0-6, name only. */
class V1DB extends Dexie {
  movements!: Table<Movement, string>
  weights!: Table<WeightRecord, string>
  sizes!: Table<DiaperSize, number>

  constructor (name: string) {
    super(name)
    this.version(1).stores({
      movements:
        'id, babyId, occurredAt, serverSeq, undoesMovementId, ' +
        '[babyId+occurredAt], [babyId+type], [babyId+sizeId]',
      babies: 'id',
      weights: 'id, babyId, recordedAt, serverSeq',
      sizes: 'id',
    })
  }
}

const NAME_PREFIX = 'migration-'
let migrationRun = 0

/** Creates a v1 base with real data and one user-edited weight range. */
const makeV1Base = async (edited: boolean): Promise<string> => {
  const name = `${NAME_PREFIX}${(migrationRun++).toString()}`
  const v1 = new V1DB(name)
  await v1.open()
  await v1.sizes.bulkAdd(
    Array.from({ length: 7 }, (_, id) => ({
      id,
      name: `Talla ${id.toString()}`,
    }))
  )
  const t = Date.now()
  await v1.movements.bulkAdd([
    createMovement(
      { id: 'm1', babyId: BABY, sizeId: 1, deviceId: 'd', occurredAt: t, recordedAt: t },
      { type: 'INITIAL', quantity: 84 }
    ),
    createMovement(
      { id: 'm2', babyId: BABY, sizeId: 1, deviceId: 'd', occurredAt: t, recordedAt: t },
      { type: 'USAGE', usageSource: 'OWN_STOCK', quantity: 3 }
    ),
  ])
  await v1.weights.add({
    id: 'w1',
    babyId: BABY,
    weightKg: 4.2,
    recordedAt: t,
    deviceId: 'd',
    serverSeq: 0,
  })
  if (edited) {
    await v1.sizes.update(2, { minWeightKg: 4.5, maxWeightKg: 8.5 })
  }
  v1.close()
  return name
}

describe('migration v1 → v2', () => {
  it('v1 base with data and an edited range: nothing lost, no edits overwritten', async () => {
    const name = await makeV1Base(true)
    const migrated = new CacotasDB(name)
    await migrated.open()

    // Size 7 inserted with its full seed row
    const sizes = await migrated.sizes.toArray()
    expect(sizes).toHaveLength(8)
    expect(sizes.find((s) => s.id === 7)).toEqual(DODOT_SIZES[7])

    // The edited range survives intact; the averages are resown (issue #10)
    const edited = sizes.find((s) => s.id === 2)
    expect(edited).toMatchObject({
      minWeightKg: 4.5,
      maxWeightKg: 8.5,
      dailyDiapers: 8,
      typicalMonths: 2.8,
    })

    // Missing fields of the untouched rows are filled from the seed table
    const size0 = sizes.find((s) => s.id === 0)
    expect(size0).toMatchObject({
      minWeightKg: 1.5,
      maxWeightKg: 2.5,
      dailyDiapers: 10,
      typicalMonths: 1.6,
    })

    // Movements untouched (D-02): same count, same deltas
    const movements = await migrated.movements.toArray()
    expect(movements).toHaveLength(2)
    expect(movements.map((m) => m.delta).sort((a, b) => a - b)).toEqual([-3, 84])

    // Weights untouched
    expect(await migrated.weights.toArray()).toHaveLength(1)
    migrated.close()
  })

  it('v1 base with the original seeding intact → 8 sizes identical to DODOT_SIZES', async () => {
    const name = await makeV1Base(false)
    const migrated = new CacotasDB(name)
    await migrated.open()
    const sizes = await migrated.sizes.toArray()
    expect(sizes).toHaveLength(8)
    for (const seed of DODOT_SIZES) {
      expect(sizes.find((s) => s.id === seed.id)).toEqual(seed)
    }
    migrated.close()
  })

  it('new base → seeded directly with 0-7, without passing through upgrade()', async () => {
    const fresh = makeDb()
    await fresh.open()
    // A fresh v2 base has no sizes until seedSizes runs; no upgrade needed
    expect(await fresh.sizes.count()).toBe(0)
    await seedSizes(fresh)
    expect(await fresh.sizes.count()).toBe(8)
    fresh.close()
  })
})

describe('stockBySize', () => {
  it('sums deltas across INITIAL + USAGE + UNDO', async () => {
    await db.movements.bulkAdd([
      mov({ type: 'INITIAL', quantity: 84 }),
      mov({ type: 'PURCHASE', quantity: 30 }),
      mov({ type: 'USAGE', quantity: 1 }),
      mov({ type: 'USAGE', quantity: 1 }),
    ])
    const all = await db.movements.where('babyId').equals(BABY).toArray()
    const usage = all.find((m) => m.type === 'USAGE')
    if (!usage) throw new Error('missing usage movement')
    await db.movements.add(mov({ type: 'UNDO', original: usage }))

    const stock = await stockBySize(db, BABY)
    // 84 + 30 - 1 - 1 + 1 (undo) = 113
    expect(stock.get(2)).toBe(113)
  })

  it('EXTERNAL diapers do not touch stock but UNDO of them does not either', async () => {
    const ext = mov({ type: 'USAGE', usageSource: 'EXTERNAL', quantity: 1 })
    await db.movements.bulkAdd([mov({ type: 'INITIAL', quantity: 10 }), ext])
    await db.movements.add(mov({ type: 'UNDO', original: ext }))

    const stock = await stockBySize(db, BABY)
    expect(stock.get(2)).toBe(10)
  })

  it('keeps sizes independent and allows negative stock', async () => {
    await db.movements.bulkAdd([
      mov({ type: 'INITIAL', quantity: 5, sizeId: 1 }),
      mov({ type: 'USAGE', quantity: 8, sizeId: 1 }),
    ])
    const stock = await stockBySize(db, BABY)
    expect(stock.get(1)).toBe(-3) // D-09
  })
})

describe('currentSize', () => {
  it('returns the sizeId of the last SIZE_CHANGE by occurredAt', async () => {
    const t0 = Date.now()
    await db.movements.bulkAdd([
      mov({ type: 'SIZE_CHANGE', sizeId: 1, occurredAt: t0 }),
      mov({ type: 'SIZE_CHANGE', sizeId: 2, occurredAt: t0 + 5000 }),
    ])
    expect(await currentSize(db, BABY)).toBe(2)
  })

  it('returns null when there is no SIZE_CHANGE', async () => {
    expect(await currentSize(db, BABY)).toBeNull()
  })
})

describe('liveUsage', () => {
  it('excludes undone movements and their usage window applies', async () => {
    const now = Date.now()
    const kept = mov({ type: 'USAGE', quantity: 1, occurredAt: now - 1000 })
    const removed = mov({ type: 'USAGE', quantity: 1, occurredAt: now - 2000 })
    await db.movements.bulkAdd([kept, removed])
    await db.movements.add(mov({ type: 'UNDO', original: removed }))

    const usage = await liveUsage(db, BABY, 0)
    expect(usage.map((m) => m.id)).toEqual([kept.id])
  })
})
