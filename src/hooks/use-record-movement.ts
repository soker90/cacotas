import { useEffect, useRef, useState } from 'react'
import { createMovement } from '../../shared/factory.ts'
import type { Movement, UUID } from '../../shared/types.ts'
import { db } from '../db/index.ts'
import { isStayMode } from '../lib/stay-mode.ts'
import { uuid } from '../lib/uuid.ts'
import { getDeviceId } from '../sync/device-id.ts'

const UNDO_WINDOW_MS = 5_000

interface UseRecordMovementResult {
  /** Registers one OWN_STOCK diaper of the given size. */
  recordDiaper: (sizeId: number) => Promise<void>;
  /** Reverts the last registered usage with an UNDO movement (D-11). */
  undoLast: () => Promise<void>;
  /** The last usage still inside the undo window, or null. */
  lastUsage: Movement | null;
}

export const useRecordMovement = (
  babyId: UUID
): UseRecordMovementResult => {
  const [lastUsage, setLastUsage] = useState<Movement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const recordDiaper = async (sizeId: number): Promise<void> => {
    const now = Date.now()
    const movement = createMovement(
      {
        id: uuid(),
        babyId,
        sizeId,
        deviceId: getDeviceId(),
        occurredAt: now,
        recordedAt: now,
      },
      {
        type: 'USAGE',
        // Stay mode: hospital/grandparents diapers count in history but not
        // in stock (D-05)
        usageSource: isStayMode() ? 'EXTERNAL' : 'OWN_STOCK',
        quantity: 1
      }
    )
    await db.movements.add(movement)

    setLastUsage(movement)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setLastUsage(null)
    }, UNDO_WINDOW_MS)
  }

  const undoLast = async (): Promise<void> => {
    if (!lastUsage) return
    if (timer.current) clearTimeout(timer.current)
    const now = Date.now()
    const undo = createMovement(
      {
        id: uuid(),
        babyId: lastUsage.babyId,
        sizeId: lastUsage.sizeId,
        deviceId: getDeviceId(),
        occurredAt: now,
        recordedAt: now,
      },
      { type: 'UNDO', original: lastUsage }
    )
    await db.movements.add(undo)
    setLastUsage(null)
  }

  return { recordDiaper, undoLast, lastUsage }
}
