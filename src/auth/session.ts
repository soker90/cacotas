const TOKEN_KEY = 'cacotas.auth.session'

export const getSessionToken = (): string | null =>
  localStorage.getItem(TOKEN_KEY)

export const setSessionToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token)
}

export const clearSessionToken = (): void => {
  localStorage.removeItem(TOKEN_KEY)
}

interface GoogleCredential {
  credential?: string
}

interface GoogleAccountsId {
  initialize: (options: { client_id: string; callback: (response: GoogleCredential) => void }) => void
  renderButton: (element: HTMLElement, options: { theme: string; size: string; width: number }) => void
}

interface GoogleApi {
  accounts: { id: GoogleAccountsId }
}

declare global {
  interface Window {
    google?: GoogleApi
  }
}

const loadGoogle = async (): Promise<GoogleApi> => {
  if (window.google?.accounts?.id) return window.google
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    if (existing) {
      existing.addEventListener('load', () => { resolve() }, { once: true })
      existing.addEventListener('error', () => { reject(new Error('No se pudo cargar Google')) }, { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => { resolve() }
    script.onerror = () => { reject(new Error('No se pudo cargar Google')) }
    document.head.appendChild(script)
  })
  if (!window.google?.accounts?.id) throw new Error('Google Identity Services no disponible')
  return window.google
}

export const renderGoogleButton = async (
  element: HTMLElement,
  onCredential: (credential: string) => void
): Promise<void> => {
  const clientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '')
  if (typeof clientId !== 'string' || clientId === '') throw new Error('Falta VITE_GOOGLE_CLIENT_ID')
  const google = await loadGoogle()
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      if (response.credential) onCredential(response.credential)
    },
  })
  google.accounts.id.renderButton(element, { theme: 'outline', size: 'large', width: 280 })
}

export interface GoogleAuthResult {
  token: string
  householdId: string | null
}

export const authenticateGoogle = async (idToken: string): Promise<GoogleAuthResult> => {
  const url = import.meta.env.VITE_SYNC_URL
  if (typeof url !== 'string' || url === '') throw new Error('Falta VITE_SYNC_URL')
  const response = await fetch(`${url}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken, deviceId: localStorage.getItem('cacotas.deviceId') ?? 'web' }),
  })
  if (!response.ok) throw new Error('No se pudo iniciar sesión con Google')
  const body = await response.json() as { token?: string; user?: { household_id?: string | null } }
  if (!body.token) throw new Error('Google no devolvió una sesión')
  setSessionToken(body.token)
  return { token: body.token, householdId: body.user?.household_id ?? null }
}
