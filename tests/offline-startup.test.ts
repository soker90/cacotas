import { describe, expect, it } from 'vitest'
import type { Baby } from '../shared/types.ts'
import { shouldUseCachedApp } from '../src/lib/offline-startup.ts'

const baby: Baby = {
  id: 'baby-local',
  name: 'Mateo',
  zoneId: 'Europe/Madrid',
  createdAt: 1,
  updatedAt: 1,
  serverSeq: 1,
}

describe('shouldUseCachedApp', () => {
  it('uses local data immediately when offline', () => {
    expect(shouldUseCachedApp(false, baby)).toBe(true)
  })

  it('waits for the server while online', () => {
    expect(shouldUseCachedApp(true, baby)).toBe(false)
  })

  it('does not treat an unloaded database as cached data', () => {
    expect(shouldUseCachedApp(false, undefined)).toBe(false)
    expect(shouldUseCachedApp(false, null)).toBe(false)
  })
})
