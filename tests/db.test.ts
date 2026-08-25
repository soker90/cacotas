import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMovement } from '../shared/factory.ts';
import type { Movement } from '../shared/types.ts';
import { currentSize, liveUsage, stockBySize } from '../src/db/derive.ts';
import { CacotasDB, seedSizes } from '../src/db/index.ts';

let n = 0;
const uid = () => `id-${(n++).toString().padStart(4, '0')}`;

const BABY = 'baby-1';

function makeDb(): CacotasDB {
  return new CacotasDB(`test-${uid()}`);
}

interface MovOptions {
  type: Movement['type'];
  sizeId?: number;
  quantity?: number;
  usageSource?: Movement['usageSource'];
  occurredAt?: number;
  original?: Movement;
}

function mov(opts: MovOptions): Movement {
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
            : { type: 'SIZE_CHANGE' },
  );
}

let db: CacotasDB;
beforeEach(() => {
  db = makeDb();
});

describe('seedSizes', () => {
  it('seeds sizes 0-6 once', async () => {
    await seedSizes(db);
    const sizes = await db.sizes.toArray();
    expect(sizes.map((s) => s.id).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(sizes[3]?.name).toBe('Talla 3');

    // Second call must not duplicate
    await seedSizes(db);
    expect(await db.sizes.count()).toBe(7);
  });
});

describe('stockBySize', () => {
  it('sums deltas across INITIAL + USAGE + UNDO', async () => {
    await db.movements.bulkAdd([
      mov({ type: 'INITIAL', quantity: 84 }),
      mov({ type: 'PURCHASE', quantity: 30 }),
      mov({ type: 'USAGE', quantity: 1 }),
      mov({ type: 'USAGE', quantity: 1 }),
    ]);
    const all = await db.movements.where('babyId').equals(BABY).toArray();
    const usage = all.find((m) => m.type === 'USAGE');
    if (!usage) throw new Error('missing usage movement');
    await db.movements.add(mov({ type: 'UNDO', original: usage }));

    const stock = await stockBySize(db, BABY);
    // 84 + 30 - 1 - 1 + 1 (undo) = 113
    expect(stock.get(2)).toBe(113);
  });

  it('EXTERNAL diapers do not touch stock but UNDO of them does not either', async () => {
    const ext = mov({ type: 'USAGE', usageSource: 'EXTERNAL', quantity: 1 });
    await db.movements.bulkAdd([mov({ type: 'INITIAL', quantity: 10 }), ext]);
    await db.movements.add(mov({ type: 'UNDO', original: ext }));

    const stock = await stockBySize(db, BABY);
    expect(stock.get(2)).toBe(10);
  });

  it('keeps sizes independent and allows negative stock', async () => {
    await db.movements.bulkAdd([
      mov({ type: 'INITIAL', quantity: 5, sizeId: 1 }),
      mov({ type: 'USAGE', quantity: 8, sizeId: 1 }),
    ]);
    const stock = await stockBySize(db, BABY);
    expect(stock.get(1)).toBe(-3); // D-09
  });
});

describe('currentSize', () => {
  it('returns the sizeId of the last SIZE_CHANGE by occurredAt', async () => {
    const t0 = Date.now();
    await db.movements.bulkAdd([
      mov({ type: 'SIZE_CHANGE', sizeId: 1, occurredAt: t0 }),
      mov({ type: 'SIZE_CHANGE', sizeId: 2, occurredAt: t0 + 5000 }),
    ]);
    expect(await currentSize(db, BABY)).toBe(2);
  });

  it('returns null when there is no SIZE_CHANGE', async () => {
    expect(await currentSize(db, BABY)).toBeNull();
  });
});

describe('liveUsage', () => {
  it('excludes undone movements and their usage window applies', async () => {
    const now = Date.now();
    const kept = mov({ type: 'USAGE', quantity: 1, occurredAt: now - 1000 });
    const removed = mov({ type: 'USAGE', quantity: 1, occurredAt: now - 2000 });
    await db.movements.bulkAdd([kept, removed]);
    await db.movements.add(mov({ type: 'UNDO', original: removed }));

    const usage = await liveUsage(db, BABY, 0);
    expect(usage.map((m) => m.id)).toEqual([kept.id]);
  });
});
