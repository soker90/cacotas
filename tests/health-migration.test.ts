import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

describe('D1 health migration 0006', () => {
  it('applies the real migration SQL and creates the health tables and indexes', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('PRAGMA foreign_keys = ON')
      database.exec('CREATE TABLE households (id TEXT PRIMARY KEY)')
      database.exec(readFileSync(new URL('../worker/migrations/0006_health.sql', import.meta.url), 'utf8'))

      const tables = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('treatments', 'dose_records', 'medical_appointments', 'health_notification_log') ORDER BY name"
      ).all() as Array<{ name: string }>

      expect(tables.map((table) => table.name)).toEqual([
        'dose_records',
        'health_notification_log',
        'medical_appointments',
        'treatments',
      ])

      const indexes = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_treatments_household', 'idx_dose_records_household', 'idx_medical_appointments_household', 'idx_health_notification_household') ORDER BY name"
      ).all() as Array<{ name: string }>
      expect(indexes).toHaveLength(4)

      database.prepare('INSERT INTO households (id) VALUES (?)').run('house-1')
      const insert = database.prepare(
        'INSERT INTO health_notification_log (notification_key, household_id, device_id, sent_at) VALUES (?, ?, ?, ?)'
      )
      insert.run('medication:dose-1', 'house-1', 'phone-a', 1000)
      expect(() => insert.run('medication:dose-1', 'house-1', 'phone-a', 2000)).toThrow()
      insert.run('medication:dose-1', 'house-1', 'phone-b', 1000)
    } finally {
      database.close()
    }
  })
})
