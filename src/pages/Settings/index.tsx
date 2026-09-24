import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { Sex } from '../../../shared/types.ts'
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
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index.ts'
import { createLocation, defaultLocationId } from '../../lib/locations.ts'
import { apiRequest } from '../../auth/api.ts'
import { clearSessionToken } from '../../auth/session.ts'
import { clearSyncState } from '../../sync/engine.ts'

export const Settings = () => {
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
  const locations = useLiveQuery(() => db.locations.toArray())
  const [newLocationName, setNewLocationName] = useState('')
  const [newLocationPoint, setNewLocationPoint] = useState('10')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [householdName, setHouseholdName] = useState<string | null>(null)
  const [memberCount, setMemberCount] = useState(0)
  const [inviteMessage, setInviteMessage] = useState<string | null>(null)
  const baby = useLiveQuery(() => db.babies.toCollection().first())
  const [babyName, setBabyName] = useState('')
  const [babyBirthDate, setBabyBirthDate] = useState('')
  const [babyUnborn, setBabyUnborn] = useState(false)
  const [babySex, setBabySex] = useState<Sex | null>(null)
  const [babyBirthWeight, setBabyBirthWeight] = useState('')
  const [babyPremature, setBabyPremature] = useState(false)
  const [babyWeeks, setBabyWeeks] = useState('')

  /* The form is editable, so its local state must be initialized when
   * Dexie finishes loading the baby. This is intentionally a state sync. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (baby === undefined) return
    setBabyName(baby.name)
    setBabyBirthDate(baby.birthDate ?? '')
    setBabyUnborn(baby.birthDate === undefined)
    setBabySex(baby.sex ?? null)
    setBabyBirthWeight(baby.birthWeightKg === undefined ? '' : String(baby.birthWeightKg))
    setBabyPremature(baby.gestationalWeeks !== undefined && baby.gestationalWeeks < 37)
    setBabyWeeks(baby.gestationalWeeks === undefined ? '' : String(baby.gestationalWeeks))
  }, [baby])

  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    void apiRequest<{ household?: { name?: string }; users?: unknown[] }>('/household/status').then((status) => {
      setHouseholdName(status.household?.name ?? null)
      setMemberCount(status.users?.length ?? 0)
    }).catch(() => {})
    void pushState().then(async (state) => {
      setPushSupport(state)
      // Self-heal: a subscription may exist in the browser but never have
      // reached the server (e.g. a past attempt failed silently).
      if (state === 'subscribed') {
        setResyncStatus('checking')
        try {
          await resyncSubscription()
          setResyncStatus('ok')
        } catch (err) {
          setResyncStatus(
            err instanceof Error ? err.message : 'error desconocido'
          )
        }
      }
    })
  }, [])

  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  const [activatingPush, setActivatingPush] = useState(false)

  const enablePush = async (): Promise<void> => {
    if (typeof vapidKey !== 'string' || vapidKey === '') {
      setError('Falta la clave VAPID en este build')
      return
    }
    setActivatingPush(true)
    try {
      const result = await subscribeToPush(vapidKey)
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

      {baby && (
        <section className='card'>
          <h2>Datos del bebé</h2>
          <div className='form-row'>
            <label htmlFor='settings-baby-name'>Nombre</label>
            <input id='settings-baby-name' value={babyName} onChange={(e) => { setBabyName(e.target.value) }} />
          </div>
          <label className='check-row'>
            <input type='checkbox' checked={babyUnborn} onChange={(e) => { setBabyUnborn(e.target.checked); if (e.target.checked) { setBabyBirthDate(''); setBabyPremature(false) } }} />
            Todavía no ha nacido
          </label>
          {!babyUnborn && (
            <div className='form-row'>
              <label htmlFor='settings-baby-birth-date'>Fecha de nacimiento</label>
              <input id='settings-baby-birth-date' type='date' value={babyBirthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setBabyBirthDate(e.target.value) }} />
            </div>
          )}
          <p className='muted small'>Sexo (opcional)</p>
          <div className='row settings-sex'>
            <button type='button' className={babySex === 'male' ? 'size selected' : 'size'} aria-pressed={babySex === 'male'} onClick={() => { setBabySex(babySex === 'male' ? null : 'male') }}>Niño</button>
            <button type='button' className={babySex === 'female' ? 'size selected' : 'size'} aria-pressed={babySex === 'female'} onClick={() => { setBabySex(babySex === 'female' ? null : 'female') }}>Niña</button>
          </div>
          <div className='form-row'>
            <label htmlFor='settings-baby-birth-weight'>Peso al nacer en kg (opcional)</label>
            <input id='settings-baby-birth-weight' inputMode='decimal' value={babyBirthWeight} onChange={(e) => { setBabyBirthWeight(e.target.value) }} placeholder='3,3' />
          </div>
          <label className='check-row'>
            <input type='checkbox' checked={babyPremature} onChange={(e) => { setBabyPremature(e.target.checked) }} />
            Nació antes de tiempo
          </label>
          {!babyUnborn && babyPremature && (
            <div className='form-row'>
              <label htmlFor='settings-baby-weeks'>Semanas de gestación</label>
              <input id='settings-baby-weeks' inputMode='numeric' value={babyWeeks} onChange={(e) => { setBabyWeeks(e.target.value) }} placeholder='34' />
            </div>
          )}
          <button
            type='button'
            className='primary'
            onClick={() => {
              if (babyName.trim() === '') { setError('El nombre del bebé no puede estar vacío'); return }
              if (!babyUnborn && babyBirthDate === '') { setError('Indica la fecha de nacimiento o marca que todavía no ha nacido'); return }
              const weight = babyBirthWeight.trim() === '' ? undefined : Number.parseFloat(babyBirthWeight.replace(',', '.'))
              if (babyBirthWeight.trim() !== '' && (!Number.isFinite(weight) || (weight ?? 0) <= 0)) { setError('El peso al nacer debe ser un número mayor que 0'); return }
              const weeks = babyPremature ? Number.parseInt(babyWeeks, 10) : undefined
              if (babyPremature && (!Number.isInteger(weeks) || (weeks ?? 0) < 20 || (weeks ?? 0) > 43)) { setError('Las semanas de gestación deben ser un número entre 20 y 43'); return }
              void db.babies.update(baby.id, {
                name: babyName.trim(),
                updatedAt: Date.now(),
                ...(babyUnborn ? {} : { birthDate: babyBirthDate }),
                ...(weight !== undefined ? { birthWeightKg: weight } : {}),
                ...(babySex !== null ? { sex: babySex } : {}),
                ...(weeks !== undefined ? { gestationalWeeks: weeks } : {}),
              }).then(() => { setError(null); notifyWrite() }).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'No se pudieron guardar los datos del bebé')
              })
            }}
          >
            Guardar datos del bebé
          </button>

        </section>
      )}

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
        <h2>Ubicaciones</h2>
        <p className='muted small'>Cada ubicación tiene su propio punto de pedido. La ubicación activa se elige arriba en Home.</p>
        {locations?.map((location) => (
          <div className='form-row location-settings-row' key={location.id}>
            <label htmlFor={`location-name-${location.id}`}>Nombre</label>
            <input
              id={`location-name-${location.id}`}
              value={location.name}
              onChange={(e) => {
                void db.locations.update(location.id, { name: e.target.value, updatedAt: Date.now(), deviceId: getDeviceId() }).then(() => notifyWrite())
              }}
            />
            <label htmlFor={`location-point-${location.id}`}>Punto de pedido</label>
            <input
              id={`location-point-${location.id}`}
              inputMode='numeric'
              value={String(location.reorderPoint)}
              onChange={(e) => {
                const value = Number.parseInt(e.target.value, 10)
                if (!Number.isInteger(value) || value < 0) return
                void db.locations.update(location.id, { reorderPoint: value, updatedAt: Date.now(), deviceId: getDeviceId() }).then(() => notifyWrite())
              }}
            />
            {location.id !== defaultLocationId(baby?.id ?? '') && (
              <button
                type='button'
                onClick={() => {
                  if (locations?.length === 1) return
                  void db.locations.delete(location.id).then(() => {
                    notifyWrite()
                    setError(null)
                  }).catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : 'No se pudo eliminar la ubicación')
                  })
                }}
              >
                Quitar ubicación
              </button>
            )}
          </div>
        ))}
        <div className='form-row'>
          <label htmlFor='new-location-name'>Nueva ubicación</label>
          <input id='new-location-name' value={newLocationName} onChange={(e) => setNewLocationName(e.target.value)} placeholder='Abuelos' />
          <label htmlFor='new-location-point'>Punto de pedido</label>
          <input id='new-location-point' inputMode='numeric' value={newLocationPoint} onChange={(e) => setNewLocationPoint(e.target.value)} />
          <button
            type='button'
            onClick={() => {
              const point = Number.parseInt(newLocationPoint, 10)
              if (newLocationName.trim() === '' || !Number.isInteger(point) || point < 0) {
                setError('Nombre y punto de pedido válidos')
                return
              }
              void createLocation(newLocationName, point).then(() => {
                notifyWrite()
                setNewLocationName('')
                setNewLocationPoint('10')
                setError(null)
              })
            }}
          >
            Añadir ubicación
          </button>
        </div>
      </section>

      <section className='card household-card'>
        <h2>Hogar</h2>
        <div className='household-summary'>
          <strong>{householdName ?? 'Nuestro hogar'}</strong>
          <span className='muted small'>{memberCount} de 2 miembros</span>
        </div>
        {memberCount < 2 && (
          <>
            <p className='muted small'>
              Genera un enlace y compártelo con la otra persona. Para aceptar la
              invitación tendrá que abrir ese enlace e iniciar sesión con Google.
            </p>
            <div className='household-actions'>
              <button
                type='button'
                onClick={() => {
                  void apiRequest<{ inviteUrl: string }>('/household/invite', {
                    method: 'POST',
                    body: '{}',
                  })
                    .then((result) => {
                      setInviteLink(result.inviteUrl)
                      setInviteMessage('Invitación creada.')
                      setError(null)
                    })
                    .catch((err: unknown) => {
                      setInviteMessage(null)
                      setError(
                        err instanceof Error
                          ? err.message
                          : 'No se pudo crear la invitación'
                      )
                    })
                }}
              >
                Generar enlace de invitación
              </button>
              {inviteLink && (
                <div className='form-row household-link-actions'>
                  <label htmlFor='invite-link'>Enlace de invitación</label>
                  <input
                    id='invite-link'
                    value={inviteLink}
                    readOnly
                    onFocus={(event) => {
                      event.currentTarget.select()
                    }}
                  />
                  <button
                    type='button'
                    onClick={async () => {
                      if (navigator.clipboard === undefined) {
                        setInviteMessage(
                          'No se pudo copiar. Selecciona el enlace y cópialo manualmente.'
                        )
                        return
                      }
                      try {
                        await navigator.clipboard.writeText(inviteLink)
                        setInviteMessage('Enlace copiado.')
                        setError(null)
                      } catch {
                        setInviteMessage(
                          'No se pudo copiar. Selecciona el enlace y cópialo manualmente.'
                        )
                      }
                    }}
                  >
                    Copiar enlace
                  </button>
                  {navigator.share && (
                    <button
                      type='button'
                      onClick={() => {
                        void navigator.share({
                          title: 'Invitación a Cacotas',
                          text: 'Únete a nuestro hogar en Cacotas',
                          url: inviteLink,
                        }).catch(() => {})
                      }}
                    >
                      Compartir
                    </button>
                  )}
                  {inviteMessage && (
                    <p className='muted small' role='status'>
                      {inviteMessage}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
        <div className='household-account-actions'>
          <button
            type='button'
            onClick={() => {
              if (
                !window.confirm(
                  '¿Abandonar este hogar? Si eres el último miembro se borrarán sus datos.'
                )
              ) {
                return
              }
              void Promise.all([
                db.movements
                  .filter((movement) => movement.serverSeq === 0)
                  .count(),
                db.weights
                  .filter((weight) => weight.serverSeq === 0)
                  .count(),
              ]).then(async ([pendingMovements, pendingWeights]) => {
                const pending = pendingMovements + pendingWeights
                if (pending > 0) {
                  setError(
                    'Hay cambios pendientes. Sincronízalos o exporta una copia antes de abandonar el hogar.'
                  )
                  return
                }

                await apiRequest('/household/leave', { method: 'POST' })
                clearSessionToken()
                clearSyncState(getDeviceId())
                await db.transaction(
                  'rw',
                  db.babies,
                  db.movements,
                  db.weights,
                  db.locations,
                  async () => {
                    await db.babies.clear()
                    await db.movements.clear()
                    await db.weights.clear()
                    await db.locations.clear()
                  }
                )
                window.location.reload()
              })
                .catch((err: unknown) => {
                  setError(
                    err instanceof Error ? err.message : 'No se pudo abandonar'
                  )
                })
            }}
          >
            Abandonar hogar
          </button>
          <button
            type='button'
            onClick={() => {
              if (!window.confirm('¿Cerrar sesión? Tendrás que iniciar sesión de nuevo para acceder a Cacotas.')) {
                return
              }
              clearSessionToken()
              window.location.reload()
            }}
          >
            Cerrar sesión
          </button>
          <button
            type='button'
            onClick={() => {
              if (!window.confirm('¿Borrar tu cuenta? Esta acción no se puede deshacer.')) {
                return
              }
              void apiRequest('/account/delete', { method: 'POST' })
                .then(async () => {
                  clearSessionToken()
                  clearSyncState(getDeviceId())
                  await db.transaction(
                    'rw',
                    db.babies,
                    db.movements,
                    db.weights,
                    db.locations,
                    async () => {
                      await db.babies.clear()
                      await db.movements.clear()
                      await db.weights.clear()
                      await db.locations.clear()
                    }
                  )
                  window.location.reload()
                })
                .catch((err: unknown) => {
                  setError(
                    err instanceof Error ? err.message : 'No se pudo borrar la cuenta'
                  )
                })
            }}
          >
            Borrar cuenta
          </button>
        </div>
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
        <div className='backup-actions'>
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
