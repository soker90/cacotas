import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { exportJSON, importJSON } from '../../lib/backup.ts'
import { getDeviceId } from '../../sync/device-id.ts'
import { isStayMode, setStayMode } from '../../lib/stay-mode.ts'
import {
  getCoverageDays,
  getWarningDays,
  setCoverageDays,
  setWarningDays,
} from '../../lib/settings.ts'
import { notifyWrite } from '../../sync/scheduler.ts'

export const Settings = () => {
  const [stayMode, setStayModeState] = useState(() => isStayMode())
  const [warningText, setWarningText] = useState(() =>
    String(getWarningDays())
  )
  const [coverageText, setCoverageText] = useState(() =>
    String(getCoverageDays())
  )
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
      notifyWrite()
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
        <h2>Predicciones</h2>
        <div className='form-row'>
          <label htmlFor='warning-days'>
            Avisar cuando queden menos días de stock
          </label>
          <input
            id='warning-days'
            inputMode='numeric'
            value={warningText}
            onChange={(e) => {
              setWarningText(e.target.value)
            }}
          />
        </div>
        <div className='form-row'>
          <label htmlFor='coverage-days'>Días de colchón objetivo</label>
          <input
            id='coverage-days'
            inputMode='numeric'
            value={coverageText}
            onChange={(e) => {
              setCoverageText(e.target.value)
            }}
          />
        </div>
        <button
          type='button'
          className='primary'
          onClick={() => {
            const warning = Number.parseInt(warningText, 10)
            const coverage = Number.parseInt(coverageText, 10)
            if (
              !Number.isInteger(warning) ||
              warning < 1 ||
              !Number.isInteger(coverage) ||
              coverage < 1
            ) {
              setError('Ambos valores deben ser enteros ≥ 1')
              return
            }
            setWarningDays(warning)
            setCoverageDays(coverage)
            setError(null)
          }}
        >
          Guardar
        </button>
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

      <p className='muted small'>
        Cacotas v{__APP_VERSION__} · dispositivo {getDeviceId()}
      </p>
    </main>
  )
}
