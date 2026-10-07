import type { Baby } from '../../shared/types.ts'

/** Cached data is safe to render immediately when the device is offline. */
export const shouldUseCachedApp = (
  isOnline: boolean,
  localBaby: Baby | null | undefined
): boolean => !isOnline && localBaby !== undefined && localBaby !== null
