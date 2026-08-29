import type { TransitionEstimate } from '../../shared/forecast.ts'

/**
 * Honest presentation of the transition estimate (§8.9, D-25): ranges
 * instead of point figures, weight always as "≈". The engine never returns
 * strings; the interface speaks.
 */

const week = (days: number): number => Math.max(1, Math.round(days / 7))

export const transitionSummary = (t: TransitionEstimate): string => {
  if (t.days === 0) return 'tocará cambiar de talla en cualquier momento'
  if (t.range !== undefined) {
    const min = week(t.range.min)
    const max = Math.max(min, week(t.range.max))
    return `probablemente entre ${min} y ${max} semanas`
  }
  if (t.days < 14) return `en unos ${t.days} días`
  return `en unas ${week(t.days)} semanas`
}

export const transitionCaveats = (t: TransitionEstimate): string[] => {
  const caveats: string[] = []
  if (t.confidence === 'LOW') {
    caveats.push('Estimación aproximada; registra un peso para afinarla.')
  }
  return caveats
}
