import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('D1 migration 0007', () => {
  it('drops the retired medication, dose, appointment and health notification tables', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('CREATE TABLE treatments (id TEXT PRIMARY KEY)')
      database.exec('CREATE TABLE dose_records (id TEXT PRIMARY KEY)')
      database.exec('CREATE TABLE medical_appointments (id TEXT PRIMARY KEY)')
      database.exec('CREATE TABLE health_notification_log (id TEXT PRIMARY KEY)')
      database.exec(readFileSync(new URL('../worker/migrations/0007_remove_health.sql', import.meta.url), 'utf8'))
      const tables = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('treatments', 'dose_records', 'medical_appointments', 'health_notification_log')"
      ).all()
      expect(tables).toHaveLength(0)
    } finally {
      database.close()
    }
  })
})
