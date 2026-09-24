import { describe, expect, it } from 'vitest'
import type { SyncRequest } from '../src/sync/types.ts'
import { HttpSyncBackend } from '../src/sync/http-backend.ts'

const request: SyncRequest = {
  deviceId: 'device-a',
  cursors: {},
  movements: [],
  weights: [],
  locations: [],
}

describe('HttpSyncBackend', () => {
  it('posts sync requests to /sync when given the Worker base URL', async () => {
    let calledUrl = ''
    let calledInit: RequestInit | undefined
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      calledUrl = String(input)
      calledInit = init
      return new Response('{}', { status: 200 })
    }

    try {
      await new HttpSyncBackend(
        'https://cacotas-sync.soker.workers.dev/',
        'test-token'
      ).sync(request)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(calledUrl).toBe(
      'https://cacotas-sync.soker.workers.dev/sync'
    )
    expect(calledInit?.method).toBe('POST')
    expect(calledInit?.headers).toEqual({
      'content-type': 'application/json',
      Authorization: 'Bearer test-token',
    })
  })
})
