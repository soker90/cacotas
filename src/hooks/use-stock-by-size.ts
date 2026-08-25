import { useLiveQuery } from 'dexie-react-hooks'
import type { UUID } from '../../shared/types.ts'
import { stockBySize } from '../db/derive.ts'
import { db } from '../db/index.ts'

/** undefined = still loading. */
export const useStockBySize = (
  babyId: UUID
): Map<number, number> | undefined =>
  useLiveQuery(() => stockBySize(db, babyId), [babyId])
