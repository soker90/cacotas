import Dexie, { type Table } from 'dexie';
import type {
  Baby,
  DiaperSize,
  Movement,
  UUID,
  WeightRecord,
} from '../../shared/types.ts';

export class CacotasDB extends Dexie {
  movements!: Table<Movement, UUID>;
  babies!: Table<Baby, UUID>;
  weights!: Table<WeightRecord, UUID>;
  sizes!: Table<DiaperSize, number>;

  constructor(name = 'cacotas') {
    super(name);
    this.version(1).stores({
      movements:
        'id, babyId, occurredAt, serverSeq, undoesMovementId, ' +
        '[babyId+occurredAt], [babyId+type], [babyId+sizeId]',
      babies: 'id',
      weights: 'id, babyId, recordedAt, serverSeq',
      sizes: 'id',
    });
  }
}

/** Seed sizes 0-6 on first creation (weight ranges optional and editable). */
export const seedSizes = async (database: CacotasDB): Promise<void> => {
  const count = await database.sizes.count();
  if (count > 0) return;
  await database.sizes.bulkPut(
    Array.from({ length: 7 }, (_, id) => ({
      id,
      name: `Talla ${id.toString()}`,
    })),
  );
};

export const createTestDB = (name: string): CacotasDB => new CacotasDB(name);

export const db = new CacotasDB();
