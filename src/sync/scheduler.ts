import { db } from '../db/index.ts'
import type { SyncBackend } from './backend.ts'
import { BabyMismatchError } from './errors.ts'
import { PermanentSyncError, TransientSyncError } from './http-backend.ts'
import { runSync } from './engine.ts'

const WRITE_DEBOUNCE_MS = 3_000
// SPEC §9.3 said 15 min; lowered to 5 so an idle open app never shows
// stock older than 5 minutes. Cost: one tiny POST per interval.
const PERIODIC_MS = 5 * 60_000
const INITIAL_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 30 * 60_000
// Quick tab flips don't need a resume sync; being away a minute or more does.
const RESUME_SYNC_MIN_HIDDEN_MS = 60_000

let backend: SyncBackend | null = null
let deviceId = ''
let running = false
let writeTimer: ReturnType<typeof setTimeout> | null = null
let nextTimer: ReturnType<typeof setTimeout> | null = null
let backoffMs = 0
let lastError: Error | null = null

export interface SyncStatus {
  lastError: Error | null
}

/** Wire the loop once the baby exists. Passing null keeps it inert. */
export const startSyncLoop = (
  activeBackend: SyncBackend | null,
  device: string
): void => {
  backend = activeBackend
  deviceId = device
  if (backend === null) return

  // On app open (§9.3)
  void trigger()
}

/** Call after every local write; debounced to 3 s. */
export const notifyWrite = (): void => {
  if (backend === null) return
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    void trigger()
  }, WRITE_DEBOUNCE_MS)
}

const stop = (err: Error): void => {
  backend = null
  lastError = err
  console.error('sync loop stopped:', err.message)
}

const trigger = async (): Promise<void> => {
  if (backend === null || running) return
  running = true
  try {
    await runSync(db, backend, deviceId)
    backoffMs = 0
    lastError = null
  } catch (err) {
    if (err instanceof PermanentSyncError) {
      // No retry per §9.1 — log quietly, never a red error for the user.
      stop(err instanceof Error ? err : new Error(String(err)))
      return
    }
    if (err instanceof BabyMismatchError) {
      stop(err)
      return
    }
    const transient =
      err instanceof TransientSyncError
        ? err
        : err instanceof Error
          ? new TransientSyncError(err.message, { cause: err })
          : new TransientSyncError('unknown sync failure')
    backoffMs =
      backoffMs === 0
        ? INITIAL_BACKOFF_MS
        : Math.min(backoffMs * 2, MAX_BACKOFF_MS)
    lastError = transient
  } finally {
    running = false
  }
  scheduleNext()
}

const scheduleNext = (): void => {
  if (nextTimer) clearTimeout(nextTimer)
  const delay = Math.max(PERIODIC_MS, backoffMs)
  nextTimer = setTimeout(() => {
    void trigger()
  }, delay)
}

export const getSyncStatus = (): SyncStatus => ({ lastError })

// Backgrounded apps freeze JS timers: neither the 3 s write debounce nor
// the periodic tick can run while the phone is locked or the tab hidden.
// A phone reopened after a while shows stale indicators until something
// pokes the loop — observed on device during the phase 5 DoD, where only
// a pull-to-refresh nudged it. Returning to the foreground after more
// than a minute away counts as "opening the app" (§9.3); sync once, now.
let hiddenAt = 0
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      return
    }
    if (hiddenAt === 0) return // nothing to resume from
    const awayFor = Date.now() - hiddenAt
    hiddenAt = 0
    if (backend !== null && awayFor >= RESUME_SYNC_MIN_HIDDEN_MS) void trigger()
  })
}
