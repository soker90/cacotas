export type UUID = string

export type MovementType =
  | 'INITIAL'
  | 'PURCHASE'
  | 'USAGE'
  | 'ADJUSTMENT'
  | 'UNDO'
  | 'SIZE_CHANGE'
  | 'SIGNAL'
  | 'SNOOZE'

export type UsageSource = 'OWN_STOCK' | 'EXTERNAL'

export type Sex = 'male' | 'female'

export interface Location {
  id: UUID;
  name: string;
  reorderPoint: number;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
}

export interface Movement {
  id: UUID;
  babyId: UUID;
  sizeId: number;
  locationId?: UUID;
  type: MovementType;
  usageSource?: UsageSource;
  quantity: number;
  delta: number;
  undoesMovementId?: UUID;
  note?: string;
  occurredAt: number;
  recordedAt: number;
  deviceId: string;
  serverSeq: number;
}

export interface Baby {
  id: UUID;
  name: string;
  birthDate?: string;
  zoneId: string;
  birthWeightKg?: number;
  sex?: Sex;
  gestationalWeeks?: number;
  createdAt: number;
  updatedAt: number;
  serverSeq: number;
}

export interface WeightRecord {
  id: UUID;
  babyId: UUID;
  weightKg: number;
  lengthCm?: number;
  recordedAt: number;
  deviceId: string;
  serverSeq: number;
}

export interface DiaperSize {
  id: number;
  name: string;
  minWeightKg?: number;
  maxWeightKg?: number;
  dailyDiapers?: number;
  typicalMonths?: number;
}

export interface TransitionSignals {
  tabsNotCentered: boolean;
  noTwoFingers: boolean;
  redMarks: boolean;
  uncoveredButtocks: boolean;
  frequentDermatitis: boolean;
  pullsDiaper: boolean;
}
