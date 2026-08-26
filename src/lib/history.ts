import type { Movement } from '../../shared/types.ts'

/**
 * History view of the ledger: hides movements undone by an UNDO and the
 * UNDO records themselves. Nothing is deleted — this is only the view (D-02).
 */
export const visibleMovements = (all: Movement[]): Movement[] => {
  const undone = new Set(
    all.filter((m) => m.type === 'UNDO').map((m) => m.undoesMovementId ?? '')
  )
  return all
    .filter((m) => m.type !== 'UNDO' && !undone.has(m.id))
    .sort(
      (a, b) =>
        b.occurredAt - a.occurredAt || b.recordedAt - a.recordedAt
    )
}

/** Whether a movement already has an UNDO pointing at it. */
export const hasBeenUndone = (all: Movement[], id: string): boolean =>
  all.some((m) => m.type === 'UNDO' && m.undoesMovementId === id)

/** Undo button label: reverting an adjustment is not "going back to 54". */
export const undoLabel = (movement: Movement): string =>
  movement.type === 'ADJUSTMENT' ? 'Revertir ajuste' : 'Deshacer'
