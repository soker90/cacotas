/**
 * Formats a logical date (`'YYYY-MM-DD'`, SPEC.md convention) as a
 * Spanish-language date for display, e.g. "4 de septiembre". Never do
 * epoch arithmetic on logical days — parse as a local date at noon to
 * dodge DST edge cases entirely (SPEC.md §5 trap table).
 */
export const formatLogicalDateEs = (day: string): string => {
  const parts = day.split('-').map(Number)
  const year = parts[0] ?? 1970
  const month = parts[1] ?? 1
  const date = parts[2] ?? 1
  const noon = new Date(year, month - 1, date, 12)
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
  }).format(noon)
}
