import { useLiveQuery } from 'dexie-react-hooks'
import type { Movement, UUID } from '../../shared/types.ts'
import { db } from '../db/index.ts'
import { visibleMovements } from '../lib/history.ts'

/** Visible history entries for a baby, newest first. undefined = loading. */
export const useHistoryMovements = (
  babyId: UUID
): Movement[] | undefined =>
  useLiveQuery(async () => {
    const all = await db.movements.where('babyId').equals(babyId).toArray()
    return visibleMovements(all)
  }, [babyId])
