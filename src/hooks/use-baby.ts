import { useLiveQuery } from 'dexie-react-hooks'
import type { Baby } from '../../shared/types.ts'
import { db } from '../db/index.ts'

/** undefined = still loading; null = no local baby yet (§9.7). */
export const useBaby = (): Baby | null | undefined =>
  useLiveQuery(
    async (): Promise<Baby | null> =>
      (await db.babies.toArray()).at(0) ?? null
  )
