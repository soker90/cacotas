import { useLiveQuery } from 'dexie-react-hooks'
import { computeForecast, type Forecast } from '../../shared/forecast.ts'
import { estimateTransition } from '../../shared/transition.ts'
import type { UUID } from '../../shared/types.ts'
import { liveUsage, lastSizeChange, stockBySize } from '../db/derive.ts'
import { db } from '../db/index.ts'
import { getCoverageDays, getWarningDays } from '../lib/settings.ts'
import { readSignals } from '../lib/transition-signals.ts'

/**
 * Live forecast for the given size (SPEC.md §7 + §8). undefined = loading;
 * null = no current size to forecast.
 */
export const useForecast = (
  babyId: UUID,
  sizeId: number | null | undefined
): Forecast | null | undefined =>
  useLiveQuery(async () => {
    if (typeof sizeId !== 'number') return null
    const [stocks, usage, sizeChange, sizes, baby, weights] = await Promise.all([
      stockBySize(db, babyId),
      liveUsage(db, babyId, 0),
      lastSizeChange(db, babyId),
      db.sizes.bulkGet([sizeId, sizeId + 1]),
      db.babies.get(babyId),
      db.weights.where('babyId').equals(babyId).sortBy('recordedAt'),
    ])
    const currentSize = sizes[0] ?? null
    const nextSize = sizes[1] ?? null
    const transition =
      currentSize === null || baby === undefined
        ? null
        : estimateTransition({
          signals: readSignals(babyId, sizeId),
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
      coverageDays: getCoverageDays(),
    })
  }, [babyId, sizeId])
