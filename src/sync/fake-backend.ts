import type { Baby, Location, Movement, UUID, WeightRecord } from '../../shared/types.ts'
import type { SyncBackend } from './backend.ts'
import type { SyncRequest, SyncResponse } from './types.ts'

/** In-memory backend that models the per-baby cursor contract. */
export class FakeSyncBackend implements SyncBackend {
  readonly movements = new Map<UUID, Movement>()
  readonly weights = new Map<UUID, WeightRecord>()
  baby: Baby | undefined
  locations = new Map<UUID, Location>()
  private readonly nextSeqByBaby = new Map<UUID, number>()

  private nextSeq (babyId: UUID): number {
    const next = this.nextSeqByBaby.get(babyId) ?? 1
    this.nextSeqByBaby.set(babyId, next + 1)
    return next
  }

  pushRemote (movement: Movement): void {
    this.movements.set(movement.id, { ...movement, serverSeq: this.nextSeq(movement.babyId) })
  }

  pushRemoteWeight (weight: WeightRecord): void {
    this.weights.set(weight.id, { ...weight, serverSeq: this.nextSeq(weight.babyId) })
  }

  setBaby (baby: Baby | undefined): void {
    this.baby = baby
  }

  sync (req: SyncRequest): Promise<SyncResponse> {
    const accepted: UUID[] = []
    for (const location of req.locations ?? []) {
      const current = this.locations.get(location.id)
      if (current === undefined || location.updatedAt > current.updatedAt) this.locations.set(location.id, location)
    }
    for (const m of req.movements) {
      if (!this.movements.has(m.id)) {
        this.movements.set(m.id, { ...m, serverSeq: this.nextSeq(m.babyId) })
      }
      accepted.push(m.id)
    }
    for (const w of req.weights) {
      if (!this.weights.has(w.id)) {
        this.weights.set(w.id, { ...w, serverSeq: this.nextSeq(w.babyId) })
      }
      accepted.push(w.id)
    }

    const freshMovements = [...this.movements.values()]
      .filter((m) => m.serverSeq > (req.cursors[m.babyId] ?? 0))
      .sort((a, b) => a.serverSeq - b.serverSeq)
    const freshWeights = [...this.weights.values()]
      .filter((w) => w.serverSeq > (req.cursors[w.babyId] ?? 0))
      .sort((a, b) => a.serverSeq - b.serverSeq)

    const babyIds = new Set([...freshMovements, ...freshWeights].map((row) => row.babyId))
    if (this.baby !== undefined) babyIds.add(this.baby.id)

    const page = <T extends { babyId: UUID; serverSeq: number }>(rows: T[]): T[] => rows.slice(0, 500)
    const movementPage = page(freshMovements)
    const weightPage = page(freshWeights)
    const cursors: Record<UUID, number> = { ...req.cursors }
    for (const row of [...movementPage, ...weightPage]) {
      cursors[row.babyId] = Math.max(cursors[row.babyId] ?? 0, row.serverSeq)
    }
    const hasMore: Record<UUID, boolean> = {}
    for (const babyId of babyIds) {
      hasMore[babyId] = freshMovements.some((m) => m.babyId === babyId && m.serverSeq > (cursors[babyId] ?? 0)) ||
        freshWeights.some((w) => w.babyId === babyId && w.serverSeq > (cursors[babyId] ?? 0))
    }

    return Promise.resolve({
      babies: this.baby === undefined ? [] : [this.baby],
      cursors,
      hasMore,
      movements: movementPage,
      weights: weightPage,
      locations: [...this.locations.values()],
      ...(this.baby !== undefined ? { baby: this.baby } : {}),
      accepted,
    })
  }
}
