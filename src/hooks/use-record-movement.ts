import { useEffect, useRef, useState } from 'react'
import { createMovement } from '../../shared/factory.ts'
import type { Movement, UUID } from '../../shared/types.ts'
import { db } from '../db/index.ts'
import { isStayMode } from '../lib/stay-mode.ts'
import { uuid } from '../lib/uuid.ts'
import { getDeviceId } from '../sync/device-id.ts'
import { notifyWrite } from '../sync/scheduler.ts'

const UNDO_WINDOW_MS = 5_000

interface UseRecordMovementResult {
  /** Registers one OWN_STOCK diaper of the given size. */
  recordDiaper: (sizeId: number) => Promise<void>;
  /** Reverts the last registered usage with an UNDO movement (D-11). */
  undoLast: () => Promise<void>;
  /** The last usage still inside the undo window, or null. */
  lastUsage: Movement | null;
  /** True while a usage movement is being persisted. */
  isRecording: boolean;
}

export const useRecordMovement = (
  babyId: UUID,
  locationId?: UUID
): UseRecordMovementResult => {
  const [lastUsage, setLastUsage] = useState<Movement | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recording = useRef(false)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const recordDiaper = async (sizeId: number): Promise<void> => {
    if (recording.current) return
    recording.current = true
    setIsRecording(true)

    try {
      const now = Date.now()
      const movement = createMovement(
        {
          id: uuid(),
          babyId,
          sizeId,
          ...(locationId !== undefined ? { locationId } : {}),
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
      notifyWrite()
      navigator.vibrate?.(30)

      setLastUsage(movement)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setLastUsage(null)
      }, UNDO_WINDOW_MS)
    } finally {
      recording.current = false
      setIsRecording(false)
    }
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
        ...(lastUsage.locationId !== undefined ? { locationId: lastUsage.locationId } : {}),
        deviceId: getDeviceId(),
        occurredAt: now,
        recordedAt: now,
      },
      { type: 'UNDO', original: lastUsage }
    )
    await db.movements.add(undo)
    notifyWrite()
    setLastUsage(null)
  }

  return { recordDiaper, undoLast, lastUsage, isRecording }
}
