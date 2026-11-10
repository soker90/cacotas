import { describe, expect, it } from 'vitest'
import {
  getUpcomingDoseTimes, isAppointmentReminderDue, isDoseReminderDue, isTreatmentFinished, mergeDoseRecords, plannedDoseId, zonedTimeToEpoch,
  type Treatment,
} from '../shared/health.ts'

const HOUR = 3_600_000
const base: Treatment = {
  id: 't1',
  babyId: 'b1',
  name: 'Tratamiento',
  schedule: { kind: 'interval', everyHours: 8 },
  startsAt: Date.UTC(2026, 0, 1, 8),
  status: 'active',
  createdAt: 0,
  updatedAt: 0,
  deviceId: 'd1',
  serverSeq: 0,
}

describe('health scheduling', () => {
  it('anchors interval doses to the start instant', () => {
    expect(getUpcomingDoseTimes(base, base.startsAt, base.startsAt + 25 * HOUR))
      .toEqual([base.startsAt + 8 * HOUR, base.startsAt + 16 * HOUR, base.startsAt + 24 * HOUR])
  })
  it('does not schedule before start or after end', () => {
    expect(getUpcomingDoseTimes({ ...base, endsAt: base.startsAt + 9 * HOUR }, base.startsAt, base.startsAt + 24 * HOUR))
      .toEqual([base.startsAt + 8 * HOUR])
  })
  it('does not generate doses while paused or finished', () => {
    expect(getUpcomingDoseTimes({ ...base, status: 'paused' }, base.startsAt, base.startsAt + 24 * HOUR)).toEqual([])
    expect(isTreatmentFinished({ ...base, endsAt: base.startsAt }, base.startsAt + 1)).toBe(true)
  })
  it('uses local clock times for daily schedules', () => {
    const daily = {
      ...base,
      startsAt: Date.UTC(2026, 0, 1),
      schedule: { kind: 'daily' as const, times: ['08:00', '20:00'] },
    }
    const from = Date.UTC(2026, 0, 1)
    const slots = getUpcomingDoseTimes(daily, from, from + 2 * 24 * HOUR)
    expect(slots).toHaveLength(4)
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    expect(formatter.format(new Date(slots[0] ?? 0))).toBe('08:00')
  })
  it('sends reminders only during the hour before the planned time', () => {
    const due = base.startsAt + 8 * HOUR
    expect(isDoseReminderDue(due, due - HOUR)).toBe(true)
    expect(isDoseReminderDue(due, due)).toBe(true)
    expect(isDoseReminderDue(due, due + 1)).toBe(false)
    expect(isDoseReminderDue(due, due - HOUR - 1)).toBe(false)
  })
  it('skips non-existent local times during the spring DST change', () => {
    expect(zonedTimeToEpoch(2026, 3, 29, 2, 30)).toBeNull()
  })
  it('chooses the first occurrence of an ambiguous autumn DST time', () => {
    const instant = zonedTimeToEpoch(2026, 10, 25, 2, 30)
    expect(instant).not.toBeNull()
    expect(new Date(instant as number).toISOString()).toBe('2026-10-25T00:30:00.000Z')
  })
  it('creates deterministic planned dose IDs', () => {
    expect(plannedDoseId('t1', 123)).toBe('dose:t1:123')
  })
  it('sends appointment reminders only in the day-before window', () => {
    const appointment = { status: 'scheduled' as const, startsAt: base.startsAt + 48 * HOUR }
    expect(isAppointmentReminderDue(appointment, appointment.startsAt - 24 * HOUR)).toBe(true)
    expect(isAppointmentReminderDue(appointment, appointment.startsAt - 23 * HOUR)).toBe(false)
    expect(isAppointmentReminderDue(appointment, appointment.startsAt - 24 * HOUR - 1)).toBe(false)
    expect(isAppointmentReminderDue({ ...appointment, status: 'cancelled' }, appointment.startsAt - 24 * HOUR)).toBe(false)
    expect(isAppointmentReminderDue({ ...appointment, status: 'completed' }, appointment.startsAt - 24 * HOUR)).toBe(false)
  })
  it('merges concurrent dose corrections and keeps both audit entries', () => {
    const common = {
      id: 'dose:t1:123',
      treatmentId: 't1',
      babyId: 'b1',
      scheduledAt: 123,
      revision: 2,
      serverSeq: 0,
      revisions: [{ status: 'omitted' as const, recordedAt: 50, deviceId: 'original' }],
    }
    const phoneA = {
      ...common,
      status: 'administered' as const,
      administeredAt: 100,
      recordedAt: 100,
      deviceId: 'phone-a',
    }
    const phoneB = {
      ...common,
      status: 'omitted' as const,
      recordedAt: 110,
      deviceId: 'phone-b',
    }
    const merged = mergeDoseRecords(phoneA, phoneB)
    expect(merged.status).toBe('omitted')
    expect(merged.deviceId).toBe('phone-b')
    expect(merged.revisions).toHaveLength(2)
    expect(merged.revisions?.map((revision) => revision.deviceId).sort())
      .toEqual(['original', 'phone-a'])
    expect(mergeDoseRecords(merged, phoneA)).toEqual(merged)
  })
})
