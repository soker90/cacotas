import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Baby } from '../../../shared/types.ts'
import {
  useCurrentSize,
  useRecordMovement,
  useStockBySize,
} from '../../hooks'
import { isStayMode } from '../../lib/stay-mode.ts'

export const Home = ({ baby }: { baby: Baby }) => {
  const sizeId = useCurrentSize(baby.id)
  const stocks = useStockBySize(baby.id)
  const { recordDiaper, undoLast, lastUsage } = useRecordMovement(baby.id)
  // Route changes remount this page, so the flag is read fresh each time
  const [stayMode] = useState(() => isStayMode())

  const stock =
    typeof sizeId === 'number' ? (stocks?.get(sizeId) ?? 0) : null

  const handleRecordDiaper = (): void => {
    if (typeof sizeId === 'number') void recordDiaper(sizeId)
  }

  return (
    <main className='home'>
      <header className='home-header'>
        <span>
          👶 {baby.name}
          {typeof sizeId === 'number' ? ` · Talla ${String(sizeId)}` : ''}
        </span>
        <Link to='/settings' aria-label='Ajustes' className='header-link'>
          ⚙️
        </Link>
      </header>

      {stayMode && (
        <p className='stay-banner' role='status'>
          🏥 Modo estancia activo — los pañales no descuentan stock
        </p>
      )}

      <button
        type='button'
        className='big-button'
        disabled={typeof sizeId !== 'number'}
        onClick={handleRecordDiaper}
      >
        🧷 PAÑAL GASTADO
      </button>

      {lastUsage && (
        <p className='toast' role='status'>
          Registrado.{' '}
          <button
            type='button'
            onClick={() => {
              void undoLast()
            }}
          >
            Deshacer
          </button>
        </p>
      )}

      <section className='stock'>
        {stock === null
          ? (
            <p className='muted'>Sin talla actual</p>
            )
          : (
            <p>
              {stock} pañales
              {stock < 0 && (
                <strong className='warn'> · revisa el inventario</strong>
              )}
            </p>
            )}
      </section>

      <footer className='home-footer'>
        <Link to='/record' className='secondary-action'>
          ＋ Registrar varios
        </Link>
      </footer>
    </main>
  )
}
