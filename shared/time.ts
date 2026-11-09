export const ZONE = 'Europe/Madrid'
export const DAY_START_HOUR = 6

/** Logical date 'YYYY-MM-DD'. The day starts at 06:00 (D-08). */
export const logicalDate = (
  epochMs: number,
  zone: string = ZONE
): string => {
  const shifted = epochMs - DAY_START_HOUR * 3_600_000
  return new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(
    new Date(shifted)
  ) // 'sv-SE' produces ISO-like format
}

/** Calendar days between two logical dates. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/**
 * A size selected during pregnancy is only considered in use from the
 * baby's birth date. Keep the original movement untouched in the ledger.
 */
export const sizeUsageStartedAt = (
  sizeStartedAt: number | null,
  birthDate: string | undefined
): number | null => {
  if (sizeStartedAt === null || birthDate === undefined) return sizeStartedAt
  const birthAt = Date.parse(`${birthDate}T12:00:00Z`)
  return Number.isFinite(birthAt) ? Math.max(sizeStartedAt, birthAt) : sizeStartedAt
}
