import { useMemo } from 'react'
import { createMovement } from '../../../shared/factory.ts'
import type { Movement } from '../../../shared/types.ts'
import type { Baby } from '../../../shared/types.ts'
import { logicalDate } from '../../../shared/time.ts'
import { db } from '../../db/index.ts'
import { useHistoryMovements } from '../../hooks'
import { hasBeenUndone, undoLabel } from '../../lib/history.ts'
import { getDeviceId } from '../../sync/device-id.ts'
import { uuid } from '../../lib/uuid.ts'

const TYPE_LABELS: Record<Movement['type'], string> = {
  INITIAL: 'Stock inicial',
  PURCHASE: 'Compra',
  USAGE: 'Pañal',
  ADJUSTMENT: 'Ajuste',
  UNDO: 'Deshacer',
  SIZE_CHANGE: 'Cambio talla',
}

const detailFor = (m: Movement): string => {
  switch (m.type) {
    case 'USAGE':
      return `Talla ${String(m.sizeId)} · ${String(m.quantity)}`
    case 'ADJUSTMENT':
      return m.delta > 0
        ? `Talla ${String(m.sizeId)} · +${String(m.delta)}`
        : `Talla ${String(m.sizeId)} · ${String(m.delta)}`
    case 'PURCHASE':
      return `Talla ${String(m.sizeId)} · +${String(m.quantity)}`
    case 'INITIAL':
      return `Talla ${String(m.sizeId)} · ${String(m.quantity)}`
    default:
      return `→ Talla ${String(m.sizeId)}`
  }
}

const formatTime = (epochMs: number): string =>
  new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochMs))

const undoMovement = async (original: Movement): Promise<void> => {
  const now = Date.now()
  const movement = createMovement(
    {
      id: uuid(),
      babyId: original.babyId,
      sizeId: original.sizeId,
      deviceId: getDeviceId(),
      occurredAt: now,
      recordedAt: now,
    },
    { type: 'UNDO', original }
  )
  await db.movements.add(movement)
}

export const History = ({ baby }: { baby: Baby }) => {
  const movements = useHistoryMovements(baby.id)

  const groups = useMemo(() => {
    if (!movements) return []
    const byDay = new Map<string, Movement[]>()
    for (const m of movements) {
      const day = logicalDate(m.occurredAt)
      const list = byDay.get(day) ?? []
      list.push(m)
      byDay.set(day, list)
    }
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [movements])

  const handleUndo = async (movement: Movement): Promise<void> => {
    // Guard against double undo: the second attempt must not re-apply
    // the inverse delta (issue #3 test).
    const all = await db.movements.where('babyId').equals(baby.id).toArray()
    if (hasBeenUndone(all, movement.id)) return
    await undoMovement(movement)
  }

  return (
    <main className='page'>
      <h1>Historial</h1>

      {groups.length === 0 && (
        <p className='muted'>Todavía no hay movimientos.</p>
      )}

      {groups.map(([day, items]) => (
        <section key={day} className='history-day'>
          <h2>{day}</h2>
          <ul className='history-list'>
            {items.map((m) => (
              <li key={m.id} className='history-row'>
                <div>
                  <span
                    className={`badge badge-${m.type}${m.usageSource === 'EXTERNAL' ? ' is-external' : ''}`}
                  >
                    {m.usageSource === 'EXTERNAL'
                      ? `${TYPE_LABELS[m.type]} 🏥`
                      : TYPE_LABELS[m.type]}
                  </span>{' '}
                  <span>{detailFor(m)}</span>
                  {m.note && <em className='muted'> — {m.note}</em>}
                </div>
                <div className='history-actions'>
                  <span className='muted'>{formatTime(m.occurredAt)}</span>
                  <button
                    type='button'
                    onClick={() => {
                      void handleUndo(m)
                    }}
                  >
                    {undoLabel(m)}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
