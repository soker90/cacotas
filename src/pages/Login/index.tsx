import { useEffect, useRef, useState } from 'react'
import { authenticateGoogle, renderGoogleButton, type GoogleAuthResult } from '../../auth/session.ts'

export const Login = ({ onLogin }: { onLogin: (auth: GoogleAuthResult) => void }) => {
  const buttonRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!buttonRef.current) return
    void renderGoogleButton(buttonRef.current, (credential) => {
      void authenticateGoogle(credential)
        .then(onLogin)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión')
        })
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'No se pudo cargar Google')
    })
  }, [onLogin])

  return (
    <main className='onboarding'>
      <h1>Cacotas</h1>
      <p>Inicia sesión para sincronizar tu hogar entre dispositivos.</p>
      <div ref={buttonRef} />
      {error && <p role='alert' className='error'>{error}</p>}
    </main>
  )
}
