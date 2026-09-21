import type { TransitionSignals, UUID } from '../../shared/types.ts'
import { createMovement } from '../../shared/factory.ts'
import type { CacotasDB } from '../db/index.ts'
import { getDeviceId } from '../sync/device-id.ts'
import { uuid } from './uuid.ts'

/**
 * Manual size-transition signals (SPEC.md §8.3). They are ledger movements
 * so the derived state is shared by every synced device.
 */

const KEY_PREFIX = 'cacotas.signals'

const key = (babyId: UUID, sizeId: number): string =>
  `${KEY_PREFIX}.${babyId}.${sizeId}`

const EMPTY: TransitionSignals = {
  tabsNotCentered: false,
  noTwoFingers: false,
  redMarks: false,
  uncoveredButtocks: false,
  frequentDermatitis: false,
  pullsDiaper: false,
}

/** Keys of the pre-#10 signal set — wiped on sight (decision: no mapping). */
const LEGACY_KEYS = ['leaks', 'tight', 'marks', 'hardToClose']

export const readSignals = (
  babyId: UUID,
  sizeId: number
): TransitionSignals => {
  const k = key(babyId, sizeId)
  try {
    const raw = localStorage.getItem(k)
    if (raw === null) return EMPTY
    const parsed = JSON.parse(raw) as Partial<TransitionSignals>
    if (LEGACY_KEYS.some((legacy) => legacy in parsed)) {
      localStorage.removeItem(k)
      return EMPTY
    }
    return { ...EMPTY, ...parsed }
  } catch {
    return EMPTY
  }
}

export const writeSignal = (
  babyId: UUID,
  sizeId: number,
  signal: keyof TransitionSignals,
  value: boolean
): void => {
  const current = readSignals(babyId, sizeId)
  localStorage.setItem(
    key(babyId, sizeId),
    JSON.stringify({ ...current, [signal]: value })
  )
}

/** Called on SIZE_CHANGE: the signals described the old size. */
export const clearSignals = (babyId: UUID, sizeId: number): void => {
  localStorage.removeItem(key(babyId, sizeId))
}

const MIGRATED_PREFIX = 'cacotas.transition-ledger-migrated'

/** One-time migration of pre-#13 localStorage state into ledger movements. */
export const migrateTransitionLocalState = async (
  database: CacotasDB,
  babyId: UUID
): Promise<void> => {
  const marker = `${MIGRATED_PREFIX}.${babyId}`
  if (localStorage.getItem(marker) === '1') return

  const now = Date.now()
  const deviceId = getDeviceId()
  const movements = await database.movements.where('babyId').equals(babyId).toArray()
  const undone = new Set(
    movements
      .filter((movement) => movement.type === 'UNDO')
      .map((movement) => movement.undoesMovementId ?? '')
  )
  const activeSignalKeys = new Set(
    movements
      .filter(
        (movement) =>
          movement.type === 'SIGNAL' &&
          movement.note !== undefined &&
          !undone.has(movement.id)
      )
      .map((movement) => movement.note as string)
  )
  const latestSnooze = movements
    .filter((movement) => movement.type === 'SNOOZE' && !undone.has(movement.id))
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .at(-1)

  const pending = []
  const storageKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))

  for (const storageKey of storageKeys)
    const prefix = `${KEY_PREFIX}.${babyId}.`
    if (storageKey === null || !storageKey.startsWith(prefix)) continue

    const sizeId = Number.parseInt(storageKey.slice(prefix.length), 10)
    if (!Number.isInteger(sizeId)) {
      localStorage.removeItem(storageKey)
      continue
    }

    const signals = readSignals(babyId, sizeId)
    for (const signal of Object.keys(signals) as Array<keyof TransitionSignals>) {
      if (signals[signal] && !activeSignalKeys.has(`${sizeId}:${signal}`)) {
        pending.push(
          createMovement(
            {
              id: uuid(),
              babyId,
              sizeId,
              deviceId,
              occurredAt: now,
              recordedAt: now,
            },
            { type: 'SIGNAL', signal }
          )
        )
        activeSignalKeys.add(`${sizeId}:${signal}`)
      }
    }
    localStorage.removeItem(storageKey)
  }

  const snoozeRaw = localStorage.getItem(`cacotas.snooze.${babyId}`)
  const snoozedUntil = snoozeRaw === null ? 0 : Number(snoozeRaw)
  if (
    Number.isFinite(snoozedUntil) &&
    snoozedUntil > now &&
    (latestSnooze === undefined ||
      now - latestSnooze.occurredAt >= 14 * 86_400_000)
  ) {
    const currentSize = movements
      .filter((movement) => movement.type === 'SIZE_CHANGE')
      .sort((a, b) => a.occurredAt - b.occurredAt)
      .at(-1)
    if (currentSize !== undefined) {
      pending.push(
        createMovement(
          {
            id: uuid(),
            babyId,
            sizeId: currentSize.sizeId,
            deviceId,
            occurredAt: snoozedUntil - 14 * 86_400_000,
            recordedAt: now,
          },
          { type: 'SNOOZE' }
        )
      )
    }
  }
  localStorage.removeItem(`cacotas.snooze.${babyId}`)
  if (pending.length > 0) await database.movements.bulkAdd(pending)
  localStorage.setItem(marker, '1')
}
