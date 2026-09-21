import { useLiveQuery } from 'dexie-react-hooks'
import { computeForecast, type Forecast } from '../../shared/forecast.ts'
import { estimateTransition } from '../../shared/transition.ts'
import type { UUID } from '../../shared/types.ts'
import { activeSignals, liveUsage, lastSizeChange, stockBySize } from '../db/derive.ts'
import { db } from '../db/index.ts'
import { getCoverageDays, getWarningDays } from '../lib/settings.ts'
import { migrateTransitionLocalState } from '../lib/transition-signals.ts'

/**
 * Live forecast for the given size (SPEC.md §7 + §8). undefined = loading;
 * null = no current size to forecast.
 *
 * Consumption is always global for the baby: locationId only scopes physical
 * stock
 * and the location-specific reorder point.
 */
export const useForecast = (
  babyId: UUID,
  sizeId: number | null | undefined,
  locationId?: string
): Forecast | null | undefined =>
  useLiveQuery(async () => {
    if (typeof sizeId !== 'number') return null
    await migrateTransitionLocalState(db, babyId)
    const [stocks, usage, sizeChange, sizes, baby, weights, location, signalSet] = await Promise.all([
      stockBySize(db, babyId, locationId),
      liveUsage(db, babyId, 0),
      lastSizeChange(db, babyId),
      db.sizes.bulkGet([sizeId, sizeId + 1]),
      db.babies.get(babyId),
      db.weights.where('babyId').equals(babyId).sortBy('recordedAt'),
      locationId === undefined ? Promise.resolve(undefined) : db.locations.get(locationId),
      activeSignals(db, babyId, sizeId),
    ])
    const currentSize = sizes[0] ?? null
    const nextSize = sizes[1] ?? null
    const transition =
      currentSize === null || baby === undefined
        ? null
        : estimateTransition({
          signals: {
            tabsNotCentered: signalSet.has('tabsNotCentered'),
            noTwoFingers: signalSet.has('noTwoFingers'),
            redMarks: signalSet.has('redMarks'),
            uncoveredButtocks: signalSet.has('uncoveredButtocks'),
            frequentDermatitis: signalSet.has('frequentDermatitis'),
            pullsDiaper: signalSet.has('pullsDiaper'),
          },
          sizeStartedAt: sizeChange?.occurredAt ?? null,
          currentSize,
          nextSize,
          weights,
          baby,
          now: Date.now(),
        })
    return computeForecast({
      stock: stocks.get(sizeId) ?? 0,
      usage,
      now: Date.now(),
      transition,
      currentSize,
      warningDays: getWarningDays(),
      ...(location?.reorderPoint !== undefined ? { reorderPoint: location.reorderPoint } : {}),
      coverageDays: getCoverageDays(),
    })
  }, [babyId, sizeId, locationId])
