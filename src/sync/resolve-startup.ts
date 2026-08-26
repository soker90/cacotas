import type { Baby, Movement } from '../../shared/types.ts'
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
  if (localBaby) return { route: 'HOME' }
  if (!backend) return { route: 'ONBOARDING' }

  try {
    const res = await backend.sync({
      deviceId,
      since: 0,
      movements: [],
      weights: [],
    })
    if (res.baby) {
      return {
        route: 'HOME',
        remote: { baby: res.baby, movements: res.movements },
      }
    }
    return { route: 'ONBOARDING' }
  } catch (err) {
    // Network failure on first device pairing: user chooses retry or start
    // fresh. The reason travels along for discreet display.
    return {
      route: 'JOIN_RETRY',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}
