import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts sync requests to /sync when given the Worker base URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await new HttpSyncBackend(
      'https://cacotas-sync.soker.workers.dev/',
      'test-token'
    ).sync(request)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cacotas-sync.soker.workers.dev/sync',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    )
  })
})
