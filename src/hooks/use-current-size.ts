import { useLiveQuery } from 'dexie-react-hooks';
import type { UUID } from '../../shared/types.ts';
import { currentSize } from '../db/derive.ts';
import { db } from '../db/index.ts';

/** undefined = loading; null = no SIZE_CHANGE yet. */
export const useCurrentSize = (
  babyId: UUID,
): number | null | undefined =>
  useLiveQuery(() => currentSize(db, babyId), [babyId]);
