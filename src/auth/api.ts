import { getSessionToken, clearSessionToken } from './session.ts'

const syncUrl = (): string => {
  const value = import.meta.env.VITE_SYNC_URL
  if (typeof value !== 'string' || value === '') throw new Error('Falta VITE_SYNC_URL')
  return value
}

export const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const token = getSessionToken()
  if (!token) throw new Error('Sesión no iniciada')
  const response = await fetch(`${syncUrl()}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  if (response.status === 401) {
    clearSessionToken()
    throw new Error('Sesión caducada')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Error ${String(response.status)}`)
  }
  return await response.json() as T
}
