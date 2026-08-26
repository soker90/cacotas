import { useEffect, useState } from 'react'
import { useBaby } from '../../hooks'
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
import {
  pushState,
  resyncSubscription,
  subscribeToPush,
  type PushSupport,
} from '../../lib/push-subscription.ts'
import { notifyWrite } from '../../sync/scheduler.ts'

export const Settings = () => {
  const baby = useBaby()
  const [stayMode, setStayModeState] = useState(() => isStayMode())
  const [warningText, setWarningText] = useState(() =>
    String(getWarningDays())
  )
  const [coverageText, setCoverageText] = useState(() =>
    String(getCoverageDays())
  )
  const [error, setError] = useState<string | null>(null)
  const [pushSupport, setPushSupport] = useState<PushSupport | null>(null)
  const [resyncStatus, setResyncStatus] = useState<string>('idle')

  useEffect(() => {
    void pushState().then(async (state) => {
      setPushSupport(state)
      // Self-heal: a subscription may exist in the browser but never have
      // reached the server (e.g. a past attempt failed silently).
      if (state === 'subscribed' && baby != null) {
        setResyncStatus('checking')
        try {
          await resyncSubscription(baby.id)
          setResyncStatus('ok')
        } catch (err) {
          setResyncStatus(
            err instanceof Error ? err.message : 'error desconocido'
          )
        }
      }
    })
  }, [baby])

  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  const [activatingPush, setActivatingPush] = useState(false)

  const enablePush = async (): Promise<void> => {
    if (typeof vapidKey !== 'string' || vapidKey === '') {
      setError('Falta la clave VAPID en este build')
      return
    }
    setActivatingPush(true)
    try {
      if (baby === null || baby === undefined) throw new Error('Sin bebé configurado')
      const result = await subscribeToPush(baby.id, vapidKey)
      setPushSupport(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo activar')
    } finally {
      setActivatingPush(false)
    }
  }

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
        <h2>Notificaciones</h2>
        {pushSupport === null && <p className='muted small'>Comprobando…</p>}
        {pushSupport === 'unsupported' && (
          <p className='muted small'>
            Este navegador no soporta notificaciones push.
          </p>
        )}
        {pushSupport === 'denied' && (
          <p className='muted small'>
            Los permisos están bloqueados: actívalos desde los ajustes del
            navegador.
          </p>
        )}
        {(pushSupport === 'subscribed' || pushSupport === 'unsubscribed') && (
          <>
            <p className='muted small'>
              Aviso diario a las 20:00 si queda poco stock. Con acción «me
              encargo yo» para silenciarlo un día.
            </p>
            {pushSupport === 'subscribed'
              ? (
                <>
                  <p className='forecast-buy'>✓ Suscrito a este dispositivo</p>
                  {resyncStatus === 'checking' && (
                    <p className='muted small'>Comprobando guardado en el servidor…</p>
                  )}
                  {resyncStatus === 'ok' && (
                    <p className='muted small'>✓ Confirmado en el servidor</p>
                  )}
                  {resyncStatus !== 'idle' &&
                    resyncStatus !== 'checking' &&
                    resyncStatus !== 'ok' && (
                      <p role='alert' className='error small'>
                        No se pudo confirmar en el servidor: {resyncStatus}
                      </p>
                  )}
                </>
                )
              : (
                <button
                  type='button'
                  className='primary'
                  disabled={activatingPush}
                  onClick={() => {
                    void enablePush()
                  }}
                >
                  {activatingPush ? 'Activando…' : 'Activar avisos en este móvil'}
                </button>
                )}
          </>
        )}
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
