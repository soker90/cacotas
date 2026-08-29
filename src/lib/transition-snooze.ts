import type { UUID } from '../../shared/types.ts'

/**
 * "Todavía no" snooze for the §8.7 prompt (SPEC.md §8.7, §17). It lives in
 * localStorage, never synced: each parent sees and silences the prompt on
 * their own device. 14 days, max one prompt per period.
 */

const KEY_PREFIX = 'cacotas.snooze'

export const SNOOZE_DAYS = 14

export const readSnooze = (babyId: UUID): number => {
  try {
    return Number(localStorage.getItem(`${KEY_PREFIX}.${babyId}`)) || 0
  } catch {
    return 0
  }
}

export const writeSnooze = (babyId: UUID, until: number): void => {
  try {
    localStorage.setItem(`${KEY_PREFIX}.${babyId}`, String(until))
  } catch {
    // private mode etc.: the prompt will just reappear
  }
}
