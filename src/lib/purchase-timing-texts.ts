import type { PurchaseTiming } from '../../shared/purchase-timing.ts'

export const purchaseTimingHeadline = (
  timing: PurchaseTiming,
  sizeId: number
): string => {
  if (timing.transitionBeforeStockRunsOut) {
    return `No acumules más talla ${String(sizeId)} por ahora.`
  }

  switch (timing.status) {
    case 'WAIT':
      return `Puedes esperar a una oferta de talla ${String(sizeId)}.`
    case 'WATCH_OFFER':
      return `Empieza a buscar una oferta de talla ${String(sizeId)}.`
    case 'BUY_NOW':
      return `No esperes a una oferta para la talla ${String(sizeId)}.`
  }
}

export const purchaseTimingDetail = (timing: PurchaseTiming): string => {
  if (timing.transitionBeforeStockRunsOut && timing.transitionDays !== null) {
    return `El cambio de talla se estima en ~${String(Math.max(0, Math.round(timing.transitionDays)))} días y tienes stock para ~${String(Math.max(0, Math.round(timing.daysRemaining ?? 0)))} días.`
  }

  const days = Math.max(0, Math.round(timing.daysRemaining ?? 0))
  switch (timing.status) {
    case 'WAIT':
      return `Tienes stock para ~${String(days)} días. Puedes esperar a que aparezca una buena oferta.`
    case 'WATCH_OFFER':
      return `Te quedan ~${String(days)} días de stock. Si aparece una buena oferta, puede ser buen momento para hacer acopio.`
    case 'BUY_NOW':
      return `Te quedan ~${String(days)} días de stock. Conviene comprar antes de quedarte sin pañales.`
  }
}
