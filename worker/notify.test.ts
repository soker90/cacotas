import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import type { Env } from './index.ts'

vi.mock('./push.ts', () => ({ sendPush: vi.fn() }))

import { sendPush } from './push.ts'
import { sendHealthPushOnce } from './notify.ts'

const makeDb = () => {
  const claims = new Set<string>()
  const deletedSubscriptions = new Set<string>()
  const db = {
    prepare: (sql: string) => {
      let args: unknown[] = []
      const statement = {
        bind: (...values: unknown[]) => {
          args = values
          return statement
        },
        first: async <T>() => {
          if (!sql.startsWith('INSERT OR IGNORE INTO health_notification_log')) return null
          const key = `${String(args[0])}:${String(args[2])}`
          if (claims.has(key)) return null
          claims.add(key)
          return { notification_key: args[0] } as T
        },
        run: async () => {
          if (sql.startsWith('DELETE FROM health_notification_log')) {
            claims.delete(`${String(args[0])}:${String(args[1])}`)
          }
          if (sql.startsWith('DELETE FROM push_subscriptions')) {
            deletedSubscriptions.add(String(args[0]))
          }
          return { success: true, meta: { changes: 1 } }
        },
      }
      return statement
    },
  }
  return { db: db as unknown as D1Database, claims, deletedSubscriptions }
}

const makeEnv = (DB: D1Database): Env => ({
  DB,
  GOOGLE_CLIENT_ID: 'client',
  VAPID_PRIVATE_KEY: 'private',
  VAPID_PUBLIC_KEY: 'public',
  VAPID_SUBJECT: 'mailto:test@example.com',
  APP_URL: 'https://cacotas.netlify.app',
})

const device = {
  deviceId: 'phone-a',
  endpoint: 'https://push.example.test/subscription',
  keys: { p256dh: 'public-key', auth: 'auth-key' },
}

describe('health push delivery', () => {
  beforeEach(() => {
    vi.mocked(sendPush).mockReset()
  })

  it('deduplicates a successfully delivered reminder per device', async () => {
    vi.mocked(sendPush).mockResolvedValue(201)
    const { db, claims } = makeDb()
    const env = makeEnv(db)

    const first = await sendHealthPushOnce(env, 'medication:dose-1', 'house-1', device, '{}', 1000)
    const second = await sendHealthPushOnce(env, 'medication:dose-1', 'house-1', device, '{}', 2000)

    expect(first).toBe('sent')
    expect(second).toBe('duplicate')
    expect(sendPush).toHaveBeenCalledTimes(1)
    expect(claims.size).toBe(1)
  })

  it('releases the claim after a transient failure so the cron can retry', async () => {
    vi.mocked(sendPush).mockResolvedValueOnce(503).mockResolvedValueOnce(201)
    const { db, claims } = makeDb()
    const env = makeEnv(db)

    const first = await sendHealthPushOnce(env, 'appointment:visit-1:2000', 'house-1', device, '{}', 1000)
    expect(first).toBe('failed')
    expect(claims.size).toBe(0)

    const retry = await sendHealthPushOnce(env, 'appointment:visit-1:2000', 'house-1', device, '{}', 2000)
    expect(retry).toBe('sent')
    expect(sendPush).toHaveBeenCalledTimes(2)
    expect(claims.size).toBe(1)
  })

  it('removes expired subscriptions and releases their claim', async () => {
    vi.mocked(sendPush).mockResolvedValue(410)
    const { db, claims, deletedSubscriptions } = makeDb()

    const outcome = await sendHealthPushOnce(makeEnv(db), 'medication:dose-2', 'house-1', device, '{}', 1000)

    expect(outcome).toBe('expired')
    expect(deletedSubscriptions.has(device.deviceId)).toBe(true)
    expect(claims.size).toBe(0)
  })

  it('releases the claim when the push transport throws', async () => {
    vi.mocked(sendPush).mockRejectedValue(new Error('network unavailable'))
    const { db, claims } = makeDb()

    const outcome = await sendHealthPushOnce(makeEnv(db), 'medication:dose-3', 'house-1', device, '{}', 1000)

    expect(outcome).toBe('failed')
    expect(claims.size).toBe(0)
  })
})
