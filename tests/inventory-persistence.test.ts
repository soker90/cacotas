import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMovement } from '../shared/factory.ts'
import { stockBySize } from '../src/db/derive.ts'
import { CacotasDB } from '../src/db/index.ts'

let sequence = 0
const uid = (): string => `inventory-${sequence++}`

const movement = (
  input: Parameters<typeof createMovement>[1],
  locationId = 'home'
) =>
  createMovement(
    {
      id: uid(),
      babyId: 'baby',
      sizeId: 2,
      locationId,
      deviceId: 'device',
      occurredAt: Date.now(),
      recordedAt: Date.now(),
    },
    input
  )

describe('location-scoped inventory persistence', () => {
  let db: CacotasDB

  beforeEach(() => {
    db = new CacotasDB(`inventory-test-${uid()}`)
  })

  it('keeps onboarding stock and own usage in the same location ledger', async () => {
    await db.movements.bulkAdd([
      movement({ type: 'INITIAL', quantity: 84 }),
      movement({ type: 'USAGE', usageSource: 'OWN_STOCK', quantity: 3 }),
      movement({ type: 'PURCHASE', quantity: 30 }),
    ])

    const stock = await stockBySize(db, 'baby', 'home')
    expect(stock.get(2)).toBe(111)
  })

  it('does not mix stock from another location', async () => {
    await db.movements.bulkAdd([
      movement({ type: 'INITIAL', quantity: 84 }, 'home'),
      movement({ type: 'PURCHASE', quantity: 20 }, 'grandparents'),
      movement({ type: 'USAGE', usageSource: 'OWN_STOCK', quantity: 3 }, 'home'),
    ])

    expect((await stockBySize(db, 'baby', 'home')).get(2)).toBe(81)
    expect((await stockBySize(db, 'baby', 'grandparents')).get(2)).toBe(20)
  })
})
