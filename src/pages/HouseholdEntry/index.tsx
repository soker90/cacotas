import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../auth/api.ts'
import { clearSessionToken } from '../../auth/session.ts'

interface Invite {
  code: string
  household_id: string
  name: string
  inviter_name: string | null
  expires_at: number
}

export type HouseholdEntryAction = 'CREATE' | 'JOIN'

export const HouseholdEntry = ({ onDone, inviteCode }: { onDone: (action: HouseholdEntryAction) => void; inviteCode?: string }) => {
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((): void => {
    void apiRequest<{ invites: Invite[] }>('/household/status', inviteCode ? { method: 'POST', body: JSON.stringify({ inviteCode }) } : { method: 'POST', body: '{}' })
      .then((result) => { setInvites(result.invites); setLoading(false) })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'No se pudo comprobar las invitaciones')
        setLoading(false)
      })
  }, [inviteCode])

  useEffect(() => { load() }, [load])

  if (loading) return <main className='loading'>…</main>
  if (error) {
    return (
      <main className='onboarding'>
        <h1>Bienvenido a Cacotas</h1>
        <p role='alert' className='error'>{error}</p>
        <button
          type='button'
          className='primary'
          onClick={() => {
            setError(null)
            setLoading(true)
            load()
          }}
        >
          Reintentar
        </button>
        <button type='button' onClick={() => { onDone('CREATE') }}>Continuar</button>
      </main>
    )
  }
  if (inviteCode && !invites.some((invite) => invite.code === inviteCode)) {
    return (
      <main className='onboarding'>
        <h1>Invitación a Cacotas</h1>
        <p>Esta invitación no aparece como pendiente. Puede haber caducado o ya haber sido utilizada.</p>
        <button type='button' onClick={onDone}>Continuar</button>
      </main>
    )
  }

  const accept = (code: string): void => {
    void apiRequest('/household/invite/accept', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }).then(() => { onDone('JOIN') }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar la invitación')
    })
  }

  const reject = (code: string): void => {
    void apiRequest('/household/invite/reject', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }).then(load).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'No se pudo rechazar la invitación')
    })
  }

  const visibleInvites = inviteCode ? [...invites.filter((invite) => invite.code === inviteCode), ...invites.filter((invite) => invite.code !== inviteCode)] : invites

  return (
    <main className='onboarding'>
      <h1>Bienvenido a Cacotas</h1>
      {invites.length > 0
        ? (
          <>
            <p>Te han invitado a este hogar:</p>
            {visibleInvites.map((invite) => (
              <section className='card' key={invite.code}>
                <h2>{invite.name}</h2>
                <p>Invita: {invite.inviter_name ?? 'Un miembro del hogar'}</p>
                <div className='row'>
                  <button type='button' className='primary' onClick={() => { accept(invite.code) }}>Aceptar</button>
                  <button type='button' onClick={() => { reject(invite.code) }}>Rechazar</button>
                </div>
              </section>
            ))}
            <button type='button' onClick={() => { onDone('CREATE') }}>Crear un hogar nuevo</button>
          </>
          )
        : (
          <>
            <p>Aún no perteneces a ningún hogar.</p>
            <button type='button' className='primary' onClick={onDone}>Crear un hogar nuevo</button>
          </>
          )}
      {error && <p role='alert' className='error'>{error}</p>}
      <button type='button' onClick={() => { clearSessionToken(); window.location.reload() }}>Desloguearme</button>
    </main>
  )
}
