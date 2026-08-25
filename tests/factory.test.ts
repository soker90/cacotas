import { describe, expect, it } from 'vitest';
import { createMovement } from '../shared/factory.ts';
import type { Movement } from '../shared/types.ts';

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  babyId: '22222222-2222-4222-8222-222222222222',
  sizeId: 2,
  deviceId: 'device-test',
  occurredAt: 1_700_000_000_000,
  recordedAt: 1_700_000_000_000,
};

const purchase60 = (over = {}): Movement =>
  createMovement(
    { ...base, id: '33333333-3333-4333-8333-333333333333', ...over },
    { type: 'PURCHASE', quantity: 60 },
  );

describe('common validations', () => {
  it('rejects sizeId out of range [0,6]', () => {
    expect(() =>
      createMovement({ ...base, sizeId: 7 }, { type: 'SIZE_CHANGE' }),
    ).toThrow();
    expect(() =>
      createMovement({ ...base, sizeId: -1 }, { type: 'SIZE_CHANGE' }),
    ).toThrow();
  });

  it('rejects occurredAt in the future beyond the 60 s tolerance', () => {
    expect(() =>
      createMovement(
        { ...base, occurredAt: base.recordedAt + 61_000 },
        { type: 'SIZE_CHANGE' },
      ),
    ).toThrow();
  });

  it('accepts occurredAt slightly ahead of recordedAt (clock tolerance)', () => {
    expect(() =>
      createMovement(
        { ...base, occurredAt: base.recordedAt + 30_000 },
        { type: 'SIZE_CHANGE' },
      ),
    ).not.toThrow();
  });

  it('always emits serverSeq = 0 (pending upload)', () => {
    expect(purchase60().serverSeq).toBe(0);
  });
});

describe('USAGE', () => {
  it('OWN_STOCK: delta = -quantity', () => {
    const m = createMovement(base, {
      type: 'USAGE',
      usageSource: 'OWN_STOCK',
      quantity: 1,
    });
    expect(m.quantity).toBe(1);
    expect(m.delta).toBe(-1);
  });

  it('EXTERNAL produces delta = 0 with quantity = 1', () => {
    const m = createMovement(base, {
      type: 'USAGE',
      usageSource: 'EXTERNAL',
      quantity: 1,
    });
    expect(m.quantity).toBe(1);
    expect(m.delta).toBe(0);
  });

  it('rejects missing usageSource', () => {
    const malformed = { type: 'USAGE', quantity: 1 };
    const input = malformed as Parameters<typeof createMovement>[1];
    expect(() => createMovement(base, input)).toThrow();
  });

  it('rejects quantity < 1', () => {
    expect(() =>
      createMovement(base, { type: 'USAGE', usageSource: 'OWN_STOCK', quantity: 0 }),
    ).toThrow();
  });
});

describe('PURCHASE', () => {
  it('delta = +quantity', () => {
    const m = purchase60();
    expect(m.quantity).toBe(60);
    expect(m.delta).toBe(60);
  });

  it('rejects quantity < 1', () => {
    expect(() =>
      createMovement(base, { type: 'PURCHASE', quantity: 0 }),
    ).toThrow();
  });
});

describe('INITIAL', () => {
  it('delta = +quantity, zero allowed', () => {
    const m = createMovement(base, { type: 'INITIAL', quantity: 0 });
    expect(m.delta).toBe(0);
    const m84 = createMovement(base, { type: 'INITIAL', quantity: 84 });
    expect(m84.delta).toBe(84);
  });

  it('rejects negative stock', () => {
    expect(() => createMovement(base, { type: 'INITIAL', quantity: -5 })).toThrow();
  });
});

describe('ADJUSTMENT', () => {
  it('stores a difference: quantity = abs(delta), delta ≠ 0', () => {
    // Adjust 54 -> 51 is recorded as delta -3
    const m = createMovement(base, { type: 'ADJUSTMENT', delta: -3 });
    expect(m.quantity).toBe(3);
    expect(m.delta).toBe(-3);
  });

  it('rejects delta = 0', () => {
    expect(() => createMovement(base, { type: 'ADJUSTMENT', delta: 0 })).toThrow();
  });
});

describe('UNDO', () => {
  it('of OWN_STOCK usage produces delta = +1', () => {
    const usage = createMovement(base, {
      type: 'USAGE',
      usageSource: 'OWN_STOCK',
      quantity: 1,
    });
    const undo = createMovement(base, { type: 'UNDO', original: usage });
    expect(undo.undoesMovementId).toBe(usage.id);
    expect(undo.quantity).toBe(1);
    expect(undo.delta).toBe(1);
  });

  it('of an EXTERNAL usage produces delta = 0', () => {
    const usage = createMovement(base, {
      type: 'USAGE',
      usageSource: 'EXTERNAL',
      quantity: 1,
    });
    const undo = createMovement(base, { type: 'UNDO', original: usage });
    expect(undo.quantity).toBe(1);
    expect(undo.delta).toBe(0);
  });

  it('of a purchase of 60 produces delta = -60', () => {
    const undo = createMovement(base, { type: 'UNDO', original: purchase60() });
    expect(undo.quantity).toBe(60);
    expect(undo.delta).toBe(-60);
  });

  it('rejects mismatched baby or size', () => {
    const usage = createMovement(base, {
      type: 'USAGE',
      usageSource: 'OWN_STOCK',
      quantity: 1,
    });
    expect(() =>
      createMovement({ ...base, sizeId: 3 }, { type: 'UNDO', original: usage }),
    ).toThrow();
    expect(() =>
      createMovement(
        { ...base, babyId: '99999999-9999-4999-8999-999999999999' },
        { type: 'UNDO', original: usage },
      ),
    ).toThrow();
  });
});

describe('SIZE_CHANGE', () => {
  it('is neutral: quantity = 0, delta = 0', () => {
    const m = createMovement(base, { type: 'SIZE_CHANGE' });
    expect(m.quantity).toBe(0);
    expect(m.delta).toBe(0);
  });
});
