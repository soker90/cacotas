import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { exportJSON, importJSON } from '../../lib/backup.ts'
import { getDeviceId } from '../../sync/device-id.ts'
import { isStayMode, setStayMode } from '../../lib/stay-mode.ts'

export const Settings = () => {
  const [stayMode, setStayModeState] = useState(() => isStayMode())
  const [error, setError] = useState<string | null>(null)

  const toggleStayMode = (checked: boolean): void => {
    setStayMode(checked)
    setStayModeState(checked)
  }

  const onImport = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await importJSON(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo importar')
    }
    e.target.value = ''
  }

  return (
    <main className='page'>
      <h1>Ajustes</h1>

      <section className='card'>
        <label className='switch-row'>
          <span>
            <strong>Estamos en el hospital</strong>
            <br />
            <span className='muted'>
              Mientras esté activo, el botón grande registra pañales que no son
              de vuestro stock.
            </span>
          </span>
          <input
            type='checkbox'
            role='switch'
            checked={stayMode}
            onChange={(e) => {
              toggleStayMode(e.target.checked)
            }}
          />
        </label>
      </section>

      <section className='card'>
        <h2>Copia de seguridad</h2>
        <div className='row'>
          <button
            type='button'
            onClick={() => {
              void exportJSON()
            }}
          >
            Exportar JSON
          </button>
          <label className='file-label'>
            Importar JSON
            <input
              type='file'
              accept='application/json'
              onChange={(e) => {
                void onImport(e)
              }}
            />
          </label>
        </div>
        <p className='muted small'>Importar reemplaza todos los datos locales.</p>
      </section>

      {error && (
        <p role='alert' className='error'>
          {error}
        </p>
      )}

      <p className='muted small'>Dispositivo: {getDeviceId()}</p>
    </main>
  )
}
