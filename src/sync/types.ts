import type {
  Baby,
  Location,
  Movement,
  UUID,
  WeightRecord,
} from '../../shared/types.ts'

/** Cursor is independent for every baby. */
export type BabyCursors = Record<UUID, number>
export type BabyHasMore = Record<UUID, boolean>

export interface SyncRequest {
  deviceId: string;
  /** Highest baby_seq known locally, keyed by baby id. */
  cursors: BabyCursors;
  /** Movements pending upload (serverSeq === 0). */
  movements: Movement[];
  weights: WeightRecord[];
  locations?: Location[];
  baby?: Baby;
}

export interface SyncResponse {
  babies: Baby[];
  /** Highest baby_seq returned for each baby in THIS response. */
  cursors: BabyCursors;
  /** True when another page remains for that baby. */
  hasMore: BabyHasMore;
  movements: Movement[];
  weights: WeightRecord[];
  locations?: Location[];
  /** Kept during the transition until multi-baby download is implemented. */
  baby?: Baby;
  /** Ids the server confirms having — including duplicates. */
  accepted: UUID[];
}
