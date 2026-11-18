import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('D1 migration 0007', () => {
  it('drops the retired medication, dose, appointment and health notification tables', () => {
    const migration = readFileSync(new URL('../worker/migrations/0007_remove_health.sql', import.meta.url), 'utf8')
    expect(migration).toContain('DROP TABLE IF EXISTS health_notification_log;')
    expect(migration).toContain('DROP TABLE IF EXISTS medical_appointments;')
    expect(migration).toContain('DROP TABLE IF EXISTS dose_records;')
    expect(migration).toContain('DROP TABLE IF EXISTS treatments;')
  })
})
