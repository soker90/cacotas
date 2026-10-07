import { describe, expect, it } from 'vitest'
import { shouldUseCachedApp } from '../src/lib/offline-startup.ts'

describe('shouldUseCachedApp', () => {
  it('uses the local app while offline', () => {
    expect(shouldUseCachedApp(false)).toBe(true)
  })

  it('uses the remote startup flow while online', () => {
    expect(shouldUseCachedApp(true)).toBe(false)
  })
})
