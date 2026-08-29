import type { Movement, UUID, UsageSource } from './types.ts'

/**
 * Single creation point for movements. Every movement in the system — client,
 * worker or physical button — must come from here. It guarantees coherence
 * between `quantity` and `delta` (D-04) and appends-only semantics (D-02).
 */

const SIZES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7]
/** Tolerance for devices with slightly fast clocks (§9.9). */
const CLOCK_TOLERANCE_MS = 60_000

export interface CommonFields {
  id: UUID;
  babyId: UUID;
  sizeId: number;
  deviceId: string;
  /** When it happened. */
  occurredAt: number;
  /** When it was recorded. Always the current instant. */
  recordedAt: number;
  note?: string;
}

export type MovementInput =
  | { type: 'USAGE'; usageSource: UsageSource; quantity: number }
  | { type: 'PURCHASE'; quantity: number }
  | { type: 'INITIAL'; quantity: number }
  | { type: 'ADJUSTMENT'; delta: number }
  | { type: 'UNDO'; original: Movement }
  | { type: 'SIZE_CHANGE' }

const fail = (rule: string): never => {
  throw new Error(`Invalid movement (${rule})`)
}

const assertCommon = (common: CommonFields): void => {
  if (!common.id) fail('id required')
  if (!common.babyId) fail('babyId required')
  if (!SIZES.includes(common.sizeId)) fail('sizeId out of range [0,7]')
  if (!common.deviceId) fail('deviceId required')
  if (common.occurredAt > common.recordedAt + CLOCK_TOLERANCE_MS) { fail('occurredAt in the future beyond tolerance') }
}

export const createMovement = (
  common: CommonFields,
  input: MovementInput
): Movement => {
  assertCommon(common)

  const { note, ...rest } = common
  const base = {
    ...rest,
    serverSeq: 0, // pending upload until the sync confirms it
    ...(note !== undefined ? { note } : {}),
  }

  let quantity = 0
  let delta = 0
  let usageSource: UsageSource | undefined
  let undoesMovementId: UUID | undefined

  switch (input.type) {
    case 'USAGE': {
      usageSource = input.usageSource
      // Runtime check: this factory also validates untrusted payloads
      // (sync ingestion), where the field may be missing despite its type.

      if (usageSource === undefined) fail('USAGE requires usageSource')
      if (!Number.isInteger(input.quantity) || input.quantity < 1) { fail('USAGE requires integer quantity >= 1') }
      quantity = input.quantity
      delta = usageSource === 'OWN_STOCK' ? -input.quantity : 0
      break
    }

    case 'PURCHASE': {
      if (!Number.isInteger(input.quantity) || input.quantity < 1) { fail('PURCHASE requires integer quantity >= 1') }
      quantity = input.quantity
      delta = input.quantity
      break
    }

    case 'INITIAL': {
      if (!Number.isInteger(input.quantity) || input.quantity < 0) { fail('INITIAL requires integer quantity >= 0') }
      quantity = input.quantity
      delta = input.quantity
      break
    }

    case 'ADJUSTMENT': {
      if (!Number.isInteger(input.delta) || input.delta === 0) { fail('ADJUSTMENT requires a non-zero integer delta') }
      delta = input.delta
      quantity = Math.abs(input.delta)
      break
    }

    case 'UNDO': {
      // Runtime check: the original may be a malformed untrusted payload.

      if (!input.original?.id) fail('UNDO requires the original movement')
      if (common.babyId !== input.original.babyId) { fail('UNDO babyId does not match original') }
      if (common.sizeId !== input.original.sizeId) { fail('UNDO sizeId does not match original') }
      undoesMovementId = input.original.id
      quantity = input.original.quantity
      // Normalize -0 to 0 so storage and comparisons stay clean
      delta = input.original.delta === 0 ? 0 : -input.original.delta
      break
    }

    case 'SIZE_CHANGE': {
      quantity = 0
      delta = 0
      break
    }

    default:
      fail('unknown movement type')
  }

  return {
    ...base,
    type: input.type,
    ...(usageSource !== undefined ? { usageSource } : {}),
    ...(undoesMovementId !== undefined ? { undoesMovementId } : {}),
    quantity,
    delta,
  }
}
