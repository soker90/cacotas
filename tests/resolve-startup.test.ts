import { describe, expect, it } from 'vitest';
import { createMovement } from '../shared/factory.ts';
import type { Baby } from '../shared/types.ts';
import { FakeSyncBackend } from '../src/sync/fake-backend.ts';
import { resolveStartup } from '../src/sync/resolve-startup.ts';

const localBaby: Baby = {
  id: 'baby-local',
  name: 'Mateo',
  zoneId: 'Europe/Madrid',
  createdAt: 1,
  updatedAt: 1,
  serverSeq: 0,
};

function remoteBaby(): Baby {
  return { ...localBaby, id: 'baby-remote' };
}

describe('resolveStartup (§9.7)', () => {
  it('goes HOME when there is a local baby', async () => {
    const d = await resolveStartup(localBaby, null);
    expect(d.route).toBe('HOME');
    expect(d.remote).toBeUndefined();
  });

  it('goes ONBOARDING without baby and without backend (phase 1)', async () => {
    const d = await resolveStartup(null, null);
    expect(d.route).toBe('ONBOARDING');
  });

  it('adopts the remote baby and skips onboarding', async () => {
    const backend = new FakeSyncBackend();
    backend.setBaby(remoteBaby());
    backend.pushRemote({
      id: 'm-remote',
      babyId: 'baby-remote',
      sizeId: 2,
      type: 'INITIAL',
      quantity: 84,
      delta: 84,
      occurredAt: Date.now(),
      recordedAt: Date.now(),
      deviceId: 'other-device',
      serverSeq: 0,
    });

    const d = await resolveStartup(null, backend);
    expect(d.route).toBe('HOME');
    expect(d.remote?.baby.id).toBe('baby-remote');
    expect(d.remote?.movements).toHaveLength(1);
  });

  it('goes ONBOARDING when the server has no baby (first device)', async () => {
    const d = await resolveStartup(null, new FakeSyncBackend());
    expect(d.route).toBe('ONBOARDING');
  });

  it('returns JOIN_RETRY on network failure', async () => {
    const failing = {
      sync: () => Promise.reject(new Error('network down')),
    };
    const d = await resolveStartup(null, failing);
    expect(d.route).toBe('JOIN_RETRY');
  });
});

describe('FakeSyncBackend server rules', () => {
  it('is idempotent by id and accepts duplicates', async () => {
    const backend = new FakeSyncBackend();
    const movement = createMovement(
      {
        id: 'm-1',
        babyId: 'b',
        sizeId: 2,
        deviceId: 'd',
        occurredAt: Date.now(),
        recordedAt: Date.now(),
      },
      { type: 'USAGE', usageSource: 'OWN_STOCK', quantity: 1 },
    );

    const first = await backend.sync({
      deviceId: 'd',
      since: 0,
      movements: [movement],
      weights: [],
    });
    // Retry after a cut connection: same payload
    const second = await backend.sync({
      deviceId: 'd',
      since: 0,
      movements: [{ ...movement, serverSeq: 0 }],
      weights: [],
    });

    expect(first.accepted).toEqual(['m-1']);
    expect(second.accepted).toEqual(['m-1']);
    expect(backend.movements.size).toBe(1); // no duplicate (D-17)
    expect(second.cursor).toBe(1); // max seq of returned rows, not global
  });
});
