import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMovement } from '../shared/factory.ts'
import type { Movement } from '../shared/types.ts'
import { stockBySize } from '../src/db/derive.ts'
import { CacotasDB, seedSizes } from '../src/db/index.ts'
import {
  hasBeenUndone,
  undoLabel,
  visibleMovements,
} from '../src/lib/history.ts'

let counter = 0
const uid = (): string => `id-${(counter++).toString().padStart(4, '0')}`
const BABY = 'baby-1'
const NOW = Date.now()

let db: CacotasDB
beforeEach(() => {
  db = new CacotasDB(`phase2-${uid()}`)
})

interface MovOptions {
  type: Movement['type']
  sizeId?: number
  quantity?: number
  usageSource?: Movement['usageSource']
  delta?: number
}

function mov (opts: MovOptions): Movement {
  const common = {
    id: uid(),
    babyId: BABY,
    sizeId: opts.sizeId ?? 2,
    deviceId: 'device-test',
    occurredAt: NOW,
    recordedAt: NOW + 1,
  }
  switch (opts.type) {
    case 'USAGE':
      return createMovement(common, {
        type: 'USAGE',
        usageSource: opts.usageSource ?? 'OWN_STOCK',
        quantity: opts.quantity ?? 1,
      })
    case 'PURCHASE':
      return createMovement(common, {
        type: 'PURCHASE',
        quantity: opts.quantity ?? 10,
      })
    case 'INITIAL':
      return createMovement(common, {
        type: 'INITIAL',
        quantity: opts.quantity ?? 50,
      })
    case 'ADJUSTMENT':
      return createMovement(common, {
        type: 'ADJUSTMENT',
        delta: opts.delta ?? -1,
      })
    default:
      return createMovement(common, { type: 'SIZE_CHANGE' })
  }
}

const undoFor = (original: Movement): Movement =>
  createMovement(
    {
      id: uid(),
      babyId: BABY,
      sizeId: original.sizeId,
      deviceId: 'device-test',
      occurredAt: NOW + 2,
      recordedAt: NOW + 3,
    },
    { type: 'UNDO', original }
  )

const stockOf = async (sizeId = 2): Promise<number> =>
  (await stockBySize(db, BABY)).get(sizeId) ?? 0

describe('fase 2 — issue #3 tests', () => {
  beforeEach(async () => {
    await seedSizes(db)
  })

  it('EXTERNAL does not alter stock but appears in the history view', async () => {
    const external = mov({ type: 'USAGE', usageSource: 'EXTERNAL' })
    await db.movements.bulkAdd([
      mov({ type: 'INITIAL', quantity: 10 }),
      external,
    ])

    expect(await stockOf()).toBe(10)
    const visible = visibleMovements(await db.movements.toArray())
    expect(visible.map((m) => m.id)).toContain(external.id)
  })

  it('undoing a purchase subtracts correctly', async () => {
    const purchase = mov({ type: 'PURCHASE', quantity: 30 })
    await db.movements.bulkAdd([mov({ type: 'INITIAL', quantity: 20 }), purchase])
    expect(await stockOf()).toBe(50)

    await db.movements.add(undoFor(purchase))
    expect(await stockOf()).toBe(20)
  })

  it('undoing an adjustment reverts the delta', async () => {
    // "Actual: 50 → Nuevo: 47" stores delta -3, never the absolute value
    const adjustment = mov({ type: 'ADJUSTMENT', delta: -3 })
    await db.movements.bulkAdd([mov({ type: 'INITIAL', quantity: 50 }), adjustment])
    expect(await stockOf()).toBe(47)

    await db.movements.add(undoFor(adjustment))
    expect(await stockOf()).toBe(50)
    // The label must speak about reverting, not restoring a number
    expect(undoLabel(adjustment)).toBe('Revertir ajuste')
  })

  it('undoing the same movement twice does not duplicate the effect', async () => {
    const purchase = mov({ type: 'PURCHASE', quantity: 60 })
    await db.movements.add(purchase)
    const firstUndo = undoFor(purchase)
    await db.movements.add(firstUndo)
    expect(await stockOf()).toBe(0)

    // Second attempt is blocked by the guard used in the UI
    const all = await db.movements.toArray()
    expect(hasBeenUndone(all, purchase.id)).toBe(true)

    // And even if a second UNDO sneaked in, the visible history stays sane:
    // the original and all its UNDOs are hidden together
    const rogueUndo = undoFor(purchase)
    await db.movements.add(rogueUndo)
    const visible = visibleMovements(await db.movements.toArray())
    expect(visible.find((m) => m.id === purchase.id)).toBeUndefined()
    expect(visible.filter((m) => m.type === 'UNDO')).toHaveLength(0)
  })

  it('a USAGE with zero stock registers and leaves stock at −1', async () => {
    await db.movements.bulkAdd([
      mov({ type: 'INITIAL', quantity: 0 }),
      mov({ type: 'USAGE', quantity: 1 }),
    ])
    expect(await stockOf()).toBe(-1) // D-09: warned, never blocked
  })
})

describe('visibleMovements', () => {
  it('hides undone movements and their UNDO records, newest first', () => {
    const initial = mov({ type: 'INITIAL', quantity: 84 })
    const usage = mov({ type: 'USAGE', quantity: 2 })
    const undo = undoFor(usage)

    const visible = visibleMovements([initial, usage, undo])
    expect(visible.map((m) => m.id)).toEqual([initial.id])
  })
})
