import { describe, expect, it } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { handleSingleMovement, resolveMovementLocationId } from './index.ts'
import type { Env } from '../worker/index.ts'

const makeDb = () => {
  const calls: Array<{ sql: string; args: unknown[] }> = []
  let firstCount = 0
  const db = {
    prepare: (sql: string) => {
      const statement = {
        bind: (...args: unknown[]) => {
          calls.push({ sql, args })
          return statement
        },
        first: <T>() => {
          firstCount += 1
          if (firstCount === 1) return { id: 'user-1', household_id: 'house-1', email: 'a@example.com', display_name: 'A' } as T
          if (firstCount === 2) return null as T | null
          if (firstCount === 3) return { id: 'baby-1' } as T
          if (firstCount === 4) return { size_id: 2 } as T
          return { id: 'grandparents' } as T
        },
        run: () => ({ success: true }),
        all: () => ({ results: [] }),
      }
      return statement
    },
  } as unknown as D1Database
  return { db, calls }
}

describe('physical button movement', () => {
  it('uses the baby default location when the button sends no location', () => {
    expect(resolveMovementLocationId('baby-1')).toBe('default:baby-1')
  })

  it('preserves an explicit location on the physical-button movement', async () => {
    expect(resolveMovementLocationId('baby-1', 'grandparents')).toBe('grandparents')

    const { db, calls } = makeDb()
    const response = await handleSingleMovement(
      new Request('https://example.test/movement', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'USAGE',
          usageSource: 'OWN_STOCK',
          deviceId: 'boton-cambiador',
          locationId: 'grandparents',
        }),
      }),
      { DB: db, GOOGLE_CLIENT_ID: 'client', VAPID_PRIVATE_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_SUBJECT: '', APP_URL: 'https://cacotas.netlify.app' } as unknown as Env
    )

    expect(response.status).toBe(200)
    const body: unknown = await response.json()
    expect(body).toMatchObject({ movement: { locationId: 'grandparents' } })
    expect(calls.at(-1)?.args.at(-1)).toBe('grandparents')
  })
})
