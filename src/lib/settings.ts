/**
 * warningDays / coverageDays (D-14 defaults). Device-local settings,
 * never synced — like stay mode.
 */

const WARNING_KEY = 'cacotas.warningDays'
const COVERAGE_KEY = 'cacotas.coverageDays'

export const DEFAULT_WARNING_DAYS = 7
export const DEFAULT_COVERAGE_DAYS = 21

const readInt = (key: string, fallback: number): number => {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback
}

export const getWarningDays = (): number =>
  readInt(WARNING_KEY, DEFAULT_WARNING_DAYS)

export const getCoverageDays = (): number =>
  readInt(COVERAGE_KEY, DEFAULT_COVERAGE_DAYS)

export const setWarningDays = (days: number): void => {
  if (Number.isInteger(days) && days >= 1) {
    localStorage.setItem(WARNING_KEY, String(days))
  }
}

export const setCoverageDays = (days: number): void => {
  if (Number.isInteger(days) && days >= 1) {
    localStorage.setItem(COVERAGE_KEY, String(days))
  }
}
