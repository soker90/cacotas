export const formatWeightKg = (weightKg: number): string =>
  weightKg.toLocaleString('es-ES', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
