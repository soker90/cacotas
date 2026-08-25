export type UUID = string

export type MovementType =
  | 'INITIAL'
  | 'PURCHASE'
  | 'USAGE'
  | 'ADJUSTMENT'
  | 'UNDO'
  | 'SIZE_CHANGE'

export type UsageSource = 'OWN_STOCK' | 'EXTERNAL'

export interface Movement {
  id: UUID;
  babyId: UUID;
  sizeId: number; // 0..6

  type: MovementType;
  usageSource?: UsageSource; // required if type === 'USAGE'

  quantity: number; // >= 0 — for statistics
  delta: number; // stock effect — may be 0 or negative

  undoesMovementId?: UUID; // required if type === 'UNDO'
  note?: string;

  occurredAt: number; // epoch ms — when it happened
  recordedAt: number; // epoch ms — when it was recorded

  deviceId: string;
  /** 0 = pending upload. The server assigns the real seq on sync. */
  serverSeq: number;
}

export interface Baby {
  id: UUID;
  name: string;
  birthDate?: string; // 'YYYY-MM-DD'
  zoneId: string; // 'Europe/Madrid'
  createdAt: number;
  updatedAt: number; // last-write-wins on sync
  serverSeq: number;
}

export interface WeightRecord {
  id: UUID;
  babyId: UUID;
  weightKg: number;
  recordedAt: number;
  deviceId: string;
  serverSeq: number;
}

export interface DiaperSize {
  id: number; // 0..6 = size number
  name: string; // 'Talla 2'
  minWeightKg?: number;
  maxWeightKg?: number;
}

/** Manual signals that the current size is getting small. */
export interface TransitionSignals {
  leaks: boolean; // frequent leaks
  tight: boolean; // fits tight
  marks: boolean; // leaves marks
  hardToClose: boolean; // hard to close
}
