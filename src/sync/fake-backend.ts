import type { Baby, Movement, UUID } from '../../shared/types.ts'
import type { SyncBackend } from './backend.ts'
import type { SyncRequest, SyncResponse } from './types.ts'

/**
 * In-memory backend for tests. Reproduces the server rules of SPEC.md §9.2:
 * insert-or-ignore by id (idempotency), download ordered by seq, accepted
 * includes duplicates.
 */
export class FakeSyncBackend implements SyncBackend {
  readonly movements = new Map<UUID, Movement>()
  weights: unknown[] = []
  baby: Baby | undefined
  private nextSeq = 1

  /** Simulate another device having written directly into the server. */
  pushRemote (movement: Movement): void {
    this.movements.set(movement.id, { ...movement, serverSeq: this.nextSeq++ })
  }

  setBaby (baby: Baby | undefined): void {
    this.baby = baby
  }

  sync (req: SyncRequest): Promise<SyncResponse> {
    const accepted: UUID[] = []
    for (const m of req.movements) {
      // INSERT OR IGNORE semantics (D-17): duplicates are "accepted" too.
      if (!this.movements.has(m.id)) {
        this.movements.set(m.id, { ...m, serverSeq: this.nextSeq++ })
      }
      accepted.push(m.id)
    }

    const all = [...this.movements.values()].sort(
      (a, b) => a.serverSeq - b.serverSeq
    )
    const fresh = all.filter((m) => m.serverSeq > req.since)
    const page = fresh.slice(0, 500)

    return Promise.resolve({
      cursor: page.length ? Math.max(...page.map((m) => m.serverSeq)) : req.since,
      hasMore: fresh.length > 500,
      movements: page,
      weights: [],
      ...(this.baby !== undefined ? { baby: this.baby } : {}),
      accepted,
    })
  }
}
