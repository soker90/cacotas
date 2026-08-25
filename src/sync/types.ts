import type {
  Baby,
  Movement,
  UUID,
  WeightRecord,
} from '../../shared/types.ts'

/** Contract of SPEC.md §9.1. Implemented by HttpSyncBackend (phase 3)
 *  and FakeSyncBackend (tests). */
export interface SyncRequest {
  deviceId: string;
  /** Highest serverSeq known locally; 0 = everything. */
  since: number;
  /** Movements pending upload (serverSeq === 0). */
  movements: Movement[];
  weights: WeightRecord[];
  baby?: Baby;
}

export interface SyncResponse {
  /** Max seq returned in THIS response (never the global max, D-16). */
  cursor: number;
  /** True if more rows remain to download. */
  hasMore: boolean;
  movements: Movement[];
  weights: WeightRecord[];
  baby?: Baby;
  /** Ids the server confirms having — including ones it ignored as duplicates (D-17). */
  accepted: UUID[];
}
