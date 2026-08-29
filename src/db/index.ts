import Dexie, { type Table } from 'dexie'
import { DODOT_SIZES } from '../../shared/transition.ts'
import type {
  Baby,
  DiaperSize,
  Movement,
  UUID,
  WeightRecord,
} from '../../shared/types.ts'

const STORES = {
  movements:
    'id, babyId, occurredAt, serverSeq, undoesMovementId, ' +
    '[babyId+occurredAt], [babyId+type], [babyId+sizeId]',
  babies: 'id',
  weights: 'id, babyId, recordedAt, serverSeq',
  sizes: 'id',
}

export class CacotasDB extends Dexie {
  movements!: Table<Movement, UUID>
  babies!: Table<Baby, UUID>
  weights!: Table<WeightRecord, UUID>
  sizes!: Table<DiaperSize, number>

  constructor (name = 'cacotas') {
    super(name)
    this.version(1).stores(STORES)
    // Issue #10: sizes gain dailyDiapers/typicalMonths and the seed table
    // grows to sizes 0-7 (§8.2). Upgrade per the issue snippet: re-sow the
    // manufacturer averages, keep user-edited weight ranges (never overwrite
    // a defined value), and insert size 7, missing from the v1 seeding.
    this.version(2)
      .stores(STORES)
      .upgrade(async (tx) => {
        const table = tx.table<DiaperSize, number>('sizes')
        const existing = await table.toArray()
        for (const seed of DODOT_SIZES) {
          const current = existing.find((s) => s.id === seed.id)
          if (current === undefined) {
            await table.add({ ...seed })
            continue
          }
          const patch: Record<string, unknown> = {
            dailyDiapers: seed.dailyDiapers,
            typicalMonths: seed.typicalMonths,
          }
          if (current.minWeightKg === undefined && seed.minWeightKg !== undefined) {
            patch.minWeightKg = seed.minWeightKg
          }
          if (current.maxWeightKg === undefined && seed.maxWeightKg !== undefined) {
            patch.maxWeightKg = seed.maxWeightKg
          }
          await table.update(current.id, patch)
        }
      })
  }
}

/** Seed sizes 0-7 with the full Dodot data on first creation (§8.2). */
export const seedSizes = async (database: CacotasDB): Promise<void> => {
  const count = await database.sizes.count()
  if (count > 0) return
  await database.sizes.bulkPut(DODOT_SIZES.map((s) => ({ ...s })))
}

export const createTestDB = (name: string): CacotasDB => new CacotasDB(name)

export const db = new CacotasDB()
