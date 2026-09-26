import type { Baby, Location, Movement, WeightRecord } from '../../shared/types.ts'
import type { HouseholdSettings } from '../../shared/types.ts'
import type { SyncBackend } from './backend.ts'

export type StartupRoute = 'HOME' | 'ONBOARDING' | 'JOIN_RETRY'

export interface StartupDecision {
  route: StartupRoute
  /**
   * Remote baby + movements to adopt. Present only when a baby was found on
   * the server; the caller persists it and goes straight to Home, skipping
   * the onboarding (§9.7).
   */
  remote?: {
    baby: Baby
    movements: Movement[]
    weights: WeightRecord[]
    locations: Location[]
    settings?: HouseholdSettings
  }
  /** Failure detail for JOIN_RETRY — shown discreetly to aid diagnosis. */
  reason?: string
}

/**
 * Pure decision function for app startup (§9.7). I/O is injected:
 * in phase 1 there is no secret configured, so `backend` is always null
 * and every launch lands on ONBOARDING.
 */
export const resolveStartup = async (
  localBaby: Baby | null,
  backend: SyncBackend | null,
  deviceId: string
): Promise<StartupDecision> => {
  if (!backend) return localBaby ? { route: 'HOME' } : { route: 'ONBOARDING' }

  try {
    // Probe the server before trusting local state. This prevents an old
    // browser cache/database from deciding what household data to display.
    const res = await backend.sync({
      deviceId,
      cursors: {},
      movements: [],
      weights: [],
      locations: [],
    })
    if (res.babies[0]) {
      return {
        route: 'HOME',
        remote: {
          baby: res.babies[0],
          movements: res.movements,
          weights: res.weights,
          locations: res.locations ?? [],
          ...(res.settings !== undefined ? { settings: res.settings } : {}),
        },
      }
    }
    // A server-authenticated household without a baby is the source of truth.
    // The caller must clear any stale local baby before entering onboarding.
    return { route: 'ONBOARDING' }
  } catch (err) {
    // With an authenticated household, local data is not authoritative.
    // Showing it after a failed remote check can expose stale data from a
    // previous household/device state. Force an explicit retry instead.
    return {
      route: 'JOIN_RETRY',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}
