import type { Forecast } from '../../shared/forecast.ts'
import { transitionSummary } from './transition-texts.ts'

/**
 * UI texts for each forecast status (SPEC.md §7.5). The engine never
 * returns strings; the interface speaks.
 */
export const forecastHeadline = (
  forecast: Forecast,
  sizeId: number
): string => {
  switch (forecast.status) {
    case 'NO_DATA':
      return 'Estamos aprendiendo el patrón de consumo.'
    case 'OK':
      return `Quedan ≈ ${String(Math.round(forecast.daysRemaining ?? 0))} días.`
    case 'BUY_NOW':
      return `Conviene comprar pañales de talla ${String(sizeId)}.`
    case 'BUY_BOTH_SIZES':
      return `Queda poco stock y el cambio de talla se acerca: compra un paquete pequeño de la talla ${String(sizeId)} y otro de la ${String(sizeId + 1)}.`
    case 'HOLD_SIZE_CHANGE':
      return `No parece conveniente comprar más talla ${String(sizeId)}. Es probable que paséis a la ${String(sizeId + 1)} antes de agotarlos.`
  }
}

/** Caveat lines shown below the headline, never invented numbers. */
export const forecastCaveats = (forecast: Forecast): string[] => {
  const caveats: string[] = []
  // §7.2.1: the seeded figure is always labelled — never a bare number
  if (forecast.seeded && forecast.dailyConsumption !== null) {
    caveats.push(
      `Estimación del fabricante: ≈ ${forecast.dailyConsumption.toLocaleString('es-ES')} pañales al día.`
    )
  }
  if (forecast.confidence === 'LOW' && !forecast.seeded) { caveats.push('Predicción poco fiable todavía.') }
  if (forecast.variabilityHigh) { caveats.push('El consumo es irregular.') }
  // SIZE_CHANGE_APPROACHING (SPEC.md §12): app-only notice. Skipped when
  // HOLD_SIZE_CHANGE / BUY_BOTH_SIZES already communicate the transition
  // via the headline, to avoid saying it twice.
  if (
    forecast.transition !== null &&
    forecast.status !== 'HOLD_SIZE_CHANGE' &&
    forecast.status !== 'BUY_BOTH_SIZES'
  ) {
    caveats.push(
      `Cambio de talla ${transitionSummary(forecast.transition)}.`
    )
  }
  return caveats
}

/** Confidence label for the little bar in Home. */
export const confidenceLabel = (forecast: Forecast): string | null => {
  switch (forecast.confidence) {
    case 'HIGH':
      return 'predicción fiable'
    case 'MEDIUM':
      return 'predicción razonable'
    case 'LOW':
      return 'pocos datos'
    default:
      return null
  }
}
