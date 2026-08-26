import { useLiveQuery } from 'dexie-react-hooks'
import { computeForecast, type Forecast } from '../../shared/forecast.ts'
import { transitionDays } from '../../shared/transition.ts'
import type { UUID } from '../../shared/types.ts'
import { liveUsage, stockBySize } from '../db/derive.ts'
import { db } from '../db/index.ts'
import { readSignals } from '../lib/transition-signals.ts'

/**
 * Live forecast for the given size (SPEC.md §7). undefined = loading;
 * null = no current size to forecast.
 */
export const useForecast = (
  babyId: UUID,
  sizeId: number | null | undefined
): Forecast | null | undefined =>
  useLiveQuery(async () => {
    if (typeof sizeId !== 'number') return null
    const [stocks, usage] = await Promise.all([
      stockBySize(db, babyId),
      liveUsage(db, babyId, 0),
    ])
    const signals = readSignals(babyId, sizeId)
    return computeForecast({
      stock: stocks.get(sizeId) ?? 0,
      usage,
      now: Date.now(),
      transitionDays: transitionDays(signals),
      warningDays: 7,
      coverageDays: 21,
    })
  }, [babyId, sizeId])
