import type { SyncBackend } from './backend.ts'
import type { SyncRequest, SyncResponse } from './types.ts'

/** 401/400: retrying will not help (§9.1). */
export class PermanentSyncError extends Error {}

/** Network / 5xx: transient, retry with backoff. */
export class TransientSyncError extends Error {}

export class HttpSyncBackend implements SyncBackend {
  readonly #url: string
  readonly #secret: string

  constructor (url: string, secret: string) {
    this.#url = url
    this.#secret = secret
  }

  async sync (req: SyncRequest): Promise<SyncResponse> {
    let response: Response
    try {
      response = await fetch(this.#url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Auth': this.#secret,
        },
        body: JSON.stringify(req),
      })
    } catch (cause) {
      throw new TransientSyncError('network unreachable', { cause })
    }

    if (response.status === 401 || response.status === 400) {
      throw new PermanentSyncError(
        `sync rejected with ${String(response.status)}`
      )
    }
    if (!response.ok) {
      throw new TransientSyncError(`server error ${String(response.status)}`)
    }
    return (await response.json()) as SyncResponse
  }
}
