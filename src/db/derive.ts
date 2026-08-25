import type { Movement, UUID } from '../../shared/types.ts';
import type { CacotasDB } from './index.ts';

/** Stock per size = sum of deltas. */
export async function stockBySize(
  database: CacotasDB,
  babyId: UUID,
): Promise<Map<number, number>> {
  const movs = await database.movements.where('babyId').equals(babyId).toArray();
  const out = new Map<number, number>();
  for (const m of movs) {
    out.set(m.sizeId, (out.get(m.sizeId) ?? 0) + m.delta);
  }
  return out;
}

/** Current size = sizeId of the last SIZE_CHANGE by occurredAt. null if none. */
export async function currentSize(
  database: CacotasDB,
  babyId: UUID,
): Promise<number | null> {
  const changes = await database.movements
    .where('[babyId+type]')
    .equals([babyId, 'SIZE_CHANGE'])
    .sortBy('occurredAt');
  return changes.at(-1)?.sizeId ?? null;
}

/**
 * Live (non-undone) usage movements since a given instant.
 * A movement is undone if an UNDO points at it via undoesMovementId.
 * Both remain in the database (D-02); they are only filtered here.
 */
export async function liveUsage(
  database: CacotasDB,
  babyId: UUID,
  from: number,
): Promise<Movement[]> {
  const all = await database.movements.where('babyId').equals(babyId).toArray();
  const undone = new Set(
    all.filter((m) => m.type === 'UNDO').map((m) => m.undoesMovementId ?? ''),
  );
  return all.filter(
    (m) =>
      m.type === 'USAGE' && m.occurredAt >= from && !undone.has(m.id),
  );
}
