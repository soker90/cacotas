import { describe, expect, it } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { handleSingleMovement, resolveMovementLocationId } from '../worker/index.ts'
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
        first: async <T>() => {
          firstCount += 1
          if (firstCount === 1) return null as T | null
          if (firstCount === 2) return { size_id: 2 } as T
          if (firstCount === 3) return { id: 'baby-1' } as T
          return { id: 'default:baby-1' } as T
        },
        run: async () => ({ success: true }),
        all: async () => ({ results: [] }),
      }
      return statement
    },
  } as unknown as D1Database
  return { db, calls }
}

describe('physical button movement', () => {
  it('uses the baby default location when the button sends no location', async () => {
    expect(resolveMovementLocationId('baby-1')).toBe('default:baby-1')
  })

  it('preserves an explicit location on the physical-button movement', async () => {
    expect(resolveMovementLocationId('baby-1', 'grandparents')).toBe('grandparents')

    const { db, calls } = makeDb()
    const response = await handleSingleMovement(
      new Request('https://example.test/movement', {
        method: 'POST',
        body: JSON.stringify({
          type: 'USAGE',
          usageSource: 'OWN_STOCK',
          deviceId: 'boton-cambiador',
          locationId: 'grandparents',
        }),
      }),
      { DB: db, AUTH_SECRET: 'secret' } as Env
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { movement: { locationId: string } }
    expect(body.movement.locationId).toBe('grandparents')
    expect(calls.at(-1)?.args.at(-1)).toBe('grandparents')
  })
})
