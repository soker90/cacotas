import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { estimateTransition, estimateWeightKg } from '../../shared/transition.ts'
import { daysBetween, logicalDate } from '../../shared/time.ts'
import type { Baby } from '../../shared/types.ts'
import { createMovement } from '../../shared/factory.ts'
import { activeSignals, lastSizeChange, snoozeActive } from '../db/derive.ts'
import { db } from '../db/index.ts'
import { getDeviceId } from '../sync/device-id.ts'
import { uuid } from '../lib/uuid.ts'
import { notifyWrite } from '../sync/scheduler.ts'
import { migrateTransitionLocalState } from '../lib/transition-signals.ts'

const PROMPT_DAYS = 7 // §8.7: the prompt appears when transition.days <= 7

/**
 * "¿Le queda pequeño el pañal?" (§8.7). Shown on Home and on the current
 * size detail when the transition estimate is within 7 days. "Sí" records
 * the SIZE_CHANGE; "Todavía no" records a synced SNOOZE for 14 days.
 */
export const TransitionPrompt = ({ baby, sizeId }: { baby: Baby, sizeId: number }) => {
  useEffect(() => {
    void migrateTransitionLocalState(db, baby.id)
  }, [baby.id])

  const state = useLiveQuery(async () => {
    const now = Date.now()
    const [sizeChange, sizes, weights, self, signals, snoozed] = await Promise.all([
      lastSizeChange(db, baby.id),
      db.sizes.bulkGet([sizeId, sizeId + 1]),
      db.weights.where('babyId').equals(baby.id).sortBy('recordedAt'),
      db.babies.get(baby.id),
      activeSignals(db, baby.id, sizeId),
      snoozeActive(db, baby.id, now),
    ])
    if (self === undefined || sizeChange === null || sizes[0] === undefined) return null
    if (snoozed) return null

    const transitionSignals = {
      tabsNotCentered: signals.has('tabsNotCentered'),
      noTwoFingers: signals.has('noTwoFingers'),
      redMarks: signals.has('redMarks'),
      uncoveredButtocks: signals.has('uncoveredButtocks'),
      frequentDermatitis: signals.has('frequentDermatitis'),
      pullsDiaper: signals.has('pullsDiaper'),
    }

    const transition = estimateTransition({
      signals: transitionSignals,
      sizeStartedAt: sizeChange.occurredAt,
      currentSize: sizes[0],
      nextSize: sizes[1] ?? null,
      weights,
      baby: self,
      now,
    })
    if (transition === null || transition.days > PROMPT_DAYS) return null

    const weeksInSize = Math.floor(
      daysBetween(
        logicalDate(sizeChange.occurredAt),
        logicalDate(now)
      ) / 7
    )
    const weightKg = estimateWeightKg({ weights, baby: self, now })?.kg ?? null
    return {
      currentSizeId: sizeId,
      nextSizeId: sizeId + 1,
      weeksInSize,
      weightKg,
      transition,
    }
  }, [baby.id, sizeId])

  if (state === undefined || state === null) return null

  const confirmChange = async (): Promise<void> => {
    const now = Date.now()
    const movement = createMovement(
      {
        id: uuid(),
        babyId: baby.id,
        sizeId: state.nextSizeId,
        deviceId: getDeviceId(),
        occurredAt: now,
        recordedAt: now,
      },
      { type: 'SIZE_CHANGE' }
    )
    await db.movements.add(movement)
    notifyWrite()
  }

  return (
    <section className='card transition-prompt' role='note'>
      <h2>🧷 ¿Le queda pequeño el pañal?</h2>
      <p>
        Lleva {state.weeksInSize} {state.weeksInSize === 1 ? 'semana' : 'semanas'} con
        la talla {sizeId}
        {state.weightKg !== null &&
          ` y su peso estimado es ≈ ${state.weightKg.toLocaleString('es-ES')} kg`}
        .
      </p>
      <div className='row'>
        <button
          type='button'
          className='primary'
          onClick={() => { void confirmChange() }}
        >
          Sí, cambiar a talla {state.nextSizeId}
        </button>
        <button
          type='button'
          onClick={() => {
            const now = Date.now()
            void db.movements.add(createMovement(
              {
                id: uuid(),
                babyId: baby.id,
                sizeId: state.currentSizeId,
                deviceId: getDeviceId(),
                occurredAt: now,
                recordedAt: now,
              },
              { type: 'SNOOZE' }
            )).then(notifyWrite)
          }}
        >
          Todavía no
        </button>
      </div>
    </section>
  )
}
