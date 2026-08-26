/**
 * Notification decision logic (SPEC.md §12). Pure and shared so the client
 * tests cover exactly what the Worker cron executes.
 */

export type NotificationKind = 'STOCK_LOW' | 'PURCHASE_RECOMMENDED'

export interface LogEntry {
  state_hash: string
  sent_at: number
  snoozed_until: number | null
}

export interface NotificationDecision {
  send: boolean
  /** Why the decision was taken — logged, never shown to the user. */
  reason: 'first-time' | 'state-changed' | 'within-24h' | 'unchanged' | 'snoozed'
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Max 1 per kind+size each 24 h; never resend if the motivating state
 * hasn't changed; "me encargo yo" silences until snoozed_until.
 */
export const shouldNotify = (
  last: LogEntry | null,
  newStateHash: string,
  now: number
): NotificationDecision => {
  if (last === null) return { send: true, reason: 'first-time' }

  if (last.snoozed_until !== null && now < last.snoozed_until) {
    // Snooze means "I'll handle it" — only time lifts it, not new state.
    return { send: false, reason: 'snoozed' }
  }

  if (now - last.sent_at < DAY_MS) {
    return { send: false, reason: 'within-24h' }
  }

  if (last.state_hash === newStateHash) {
    return { send: false, reason: 'unchanged' }
  }

  return { send: true, reason: 'state-changed' }
}

/** Thursday anchoring for purchase reminders ("a considerar" in issue #5):
 *  Mon-Wed the reminder would be forgotten before the big shop. */
export const isPurchaseDay = (madridWeekday: number): boolean =>
  // 0 = Sunday … 4 = Thursday, 5 = Friday, 6 = Saturday
  [0, 4, 5, 6].includes(madridWeekday)

/** SHA-256 hex of the motivating state — stable across runs. */
export const hashState = async (parts: unknown): Promise<string> => {
  const data = new TextEncoder().encode(JSON.stringify(parts))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
