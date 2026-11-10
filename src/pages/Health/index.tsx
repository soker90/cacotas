import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Baby } from '../../../shared/types.ts'
import type { AppointmentStatus, MedicalAppointment, Treatment } from '../../../shared/health.ts'
import { getUpcomingDoseTimes, plannedDoseId } from '../../../shared/health.ts'
import { db } from '../../db/index.ts'
import { getDeviceId } from '../../sync/device-id.ts'
import { notifyWrite } from '../../sync/scheduler.ts'
import { uuid } from '../../lib/uuid.ts'

const localDateTimeValue = (timestamp: number): string => {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const currentTimestamp = (): number => Date.now()

const formatDateTime = (timestamp: number): string => new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(timestamp)

export const Health = ({ baby }: { baby: Baby }) => {
  const treatments = useLiveQuery(
    () => db.treatments.where('babyId').equals(baby.id).toArray(),
    [baby.id]
  ) ?? []
  const doses = useLiveQuery(
    () => db.doseRecords.where('babyId').equals(baby.id).toArray(),
    [baby.id]
  ) ?? []
  const appointments = useLiveQuery(
    () => db.appointments.where('babyId').equals(baby.id).toArray(),
    [baby.id]
  ) ?? []
  const doseRows = useLiveQuery(() => {
    const now = currentTimestamp()
    const recorded = new Map(doses.map((dose) => [dose.id, dose]))
    return treatments.flatMap((treatment) => getUpcomingDoseTimes(
      treatment,
      now - 24 * 60 * 60 * 1000,
      now + 7 * 24 * 60 * 60 * 1000
    ).map((scheduledAt) => ({
      treatment,
      scheduledAt,
      record: recorded.get(plannedDoseId(treatment.id, scheduledAt)),
    }))).sort((a, b) => a.scheduledAt - b.scheduledAt)
  }, [baby.id, treatments, doses]) ?? []

  const [name, setName] = useState('')
  const [activeIngredient, setActiveIngredient] = useState('')
  const [instructions, setInstructions] = useState('')
  const [treatmentNotes, setTreatmentNotes] = useState('')
  const [scheduleKind, setScheduleKind] = useState<'daily' | 'interval'>('daily')
  const [dailyTimes, setDailyTimes] = useState('08:00')
  const [intervalHours, setIntervalHours] = useState('8')
  const [startAt, setStartAt] = useState(() => localDateTimeValue(currentTimestamp()))
  const [endAt, setEndAt] = useState('')
  const [appointmentTitle, setAppointmentTitle] = useState('')
  const [appointmentAt, setAppointmentAt] = useState(() => localDateTimeValue(currentTimestamp() + 24 * 60 * 60 * 1000))
  const [appointmentPlace, setAppointmentPlace] = useState('')
  const [appointmentNotes, setAppointmentNotes] = useState('')
  const [appointmentDuration, setAppointmentDuration] = useState('')
  const [editingTreatmentId, setEditingTreatmentId] = useState<string | null>(null)
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saveTreatment = async (): Promise<void> => {
    const startsAt = new Date(startAt).getTime()
    const endsAt = endAt === '' ? undefined : new Date(endAt).getTime()
    const times = [...new Set(dailyTimes.split(',').map((time) => time.trim()))]
    const validDailyTimes = times.length > 0 && times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    const validInterval = Number.isInteger(Number(intervalHours)) && Number(intervalHours) >= 1 && Number(intervalHours) <= 24
    if (name.trim() === '' || !Number.isFinite(startsAt) || (endsAt !== undefined && (!Number.isFinite(endsAt) || endsAt < startsAt)) || (scheduleKind === 'daily' && !validDailyTimes) || (scheduleKind === 'interval' && !validInterval)) {
      setError('Revisa el nombre y las fechas del tratamiento.')
      return
    }
    const now = currentTimestamp()
    const existing = editingTreatmentId === null
      ? undefined
      : treatments.find((item) => item.id === editingTreatmentId)
    const existingFields: Partial<Treatment> = existing === undefined ? {} : { ...existing }
    if (activeIngredient.trim() === '') delete existingFields.activeIngredient
    if (instructions.trim() === '') delete existingFields.instructions
    if (treatmentNotes.trim() === '') delete existingFields.notes
    if (endsAt === undefined) delete existingFields.endsAt
    const treatment: Treatment = {
      ...existingFields,
      id: existing?.id ?? uuid(),
      babyId: baby.id,
      name: name.trim(),
      ...(activeIngredient.trim() !== '' ? { activeIngredient: activeIngredient.trim() } : {}),
      ...(instructions.trim() !== '' ? { instructions: instructions.trim() } : {}),
      ...(treatmentNotes.trim() !== '' ? { notes: treatmentNotes.trim() } : {}),
      schedule: scheduleKind === 'daily'
        ? { kind: 'daily', times }
        : { kind: 'interval', everyHours: Number(intervalHours) },
      startsAt,
      ...(endsAt !== undefined ? { endsAt } : {}),
      status: existing?.status ?? 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deviceId: getDeviceId(),
      serverSeq: 0,
    }
    await db.treatments.put(treatment)
    notifyWrite()
    setName('')
    setActiveIngredient('')
    setInstructions('')
    setTreatmentNotes('')
    setEditingTreatmentId(null)
    setError(null)
  }

  const saveAppointment = async (): Promise<void> => {
    const startsAt = new Date(appointmentAt).getTime()
    if (appointmentTitle.trim() === '' || !Number.isFinite(startsAt)) {
      setError('Introduce el motivo y una fecha válida para la cita.')
      return
    }
    const now = currentTimestamp()
    const duration = appointmentDuration.trim() === '' ? undefined : Number(appointmentDuration)
    if (duration !== undefined && (!Number.isInteger(duration) || duration < 1)) {
      setError('La duración debe ser un número entero mayor que cero.')
      return
    }
    const existing = editingAppointmentId === null
      ? undefined
      : appointments.find((item) => item.id === editingAppointmentId)
    const existingFields: Partial<MedicalAppointment> = existing === undefined ? {} : { ...existing }
    if (appointmentPlace.trim() === '') delete existingFields.place
    if (appointmentNotes.trim() === '') delete existingFields.notes
    if (duration === undefined) delete existingFields.durationMinutes
    await db.appointments.put({
      ...existingFields,
      id: existing?.id ?? uuid(),
      babyId: baby.id,
      title: appointmentTitle.trim(),
      ...(appointmentPlace.trim() !== '' ? { place: appointmentPlace.trim() } : {}),
      ...(appointmentNotes.trim() !== '' ? { notes: appointmentNotes.trim() } : {}),
      ...(duration !== undefined ? { durationMinutes: duration } : {}),
      startsAt,
      status: existing?.status ?? 'scheduled',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deviceId: getDeviceId(),
      serverSeq: 0,
    })
    notifyWrite()
    setAppointmentTitle('')
    setAppointmentPlace('')
    setAppointmentNotes('')
    setAppointmentDuration('')
    setEditingAppointmentId(null)
    setError(null)
  }

  const markDose = async (
    treatment: Treatment,
    scheduledAt: number,
    status: 'administered' | 'omitted'
  ): Promise<void> => {
    const id = plannedDoseId(treatment.id, scheduledAt)
    const existing = await db.doseRecords.get(id)
    const now = currentTimestamp()
    await db.doseRecords.put({
      id,
      treatmentId: treatment.id,
      babyId: baby.id,
      scheduledAt,
      status,
      ...(status === 'administered' ? { administeredAt: now } : {}),
      recordedAt: now,
      deviceId: getDeviceId(),
      serverSeq: 0,
      revision: (existing?.revision ?? 0) + 1,
      ...(existing !== undefined
        ? {
            revisions: [
              ...(existing.revisions ?? []),
              {
                status: existing.status,
                ...(existing.administeredAt !== undefined ? { administeredAt: existing.administeredAt } : {}),
                recordedAt: existing.recordedAt,
                deviceId: existing.deviceId,
              },
            ],
          }
        : {}),
    })
    notifyWrite()
  }

  const changeTreatmentStatus = async (
    treatment: Treatment,
    status: Treatment['status']
  ): Promise<void> => {
    const now = currentTimestamp()
    await db.treatments.put({
      ...treatment,
      status,
      updatedAt: now,
      ...(status === 'finished' ? { finishedAt: now } : {}),
      serverSeq: 0,
    })
    notifyWrite()
  }

  const changeAppointmentStatus = async (
    appointment: typeof appointments[number],
    status: AppointmentStatus
  ): Promise<void> => {
    await db.appointments.put({
      ...appointment,
      status,
      updatedAt: currentTimestamp(),
      serverSeq: 0,
    })
    notifyWrite()
  }

  const handleError = (cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : 'No se ha podido guardar el cambio.')
  }

  return (
    <main className='page'>
      <header className='page-header'>
        <h1>Salud</h1>
        <p className='muted'>Registro y recordatorios. No sustituye las indicaciones de profesionales sanitarios.</p>
      </header>
      <section className='card'>
        <h2>Medicamentos</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            saveTreatment().catch(handleError)
          }}
        >
          <label>Nombre del medicamento
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>Principio activo (opcional)
            <input value={activeIngredient} onChange={(event) => setActiveIngredient(event.target.value)} />
          </label>
          <label>Instrucciones (opcional)
            <input value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder='Cantidad o indicaciones introducidas por el adulto' />
          </label>
          <label>Notas (opcional)
            <input value={treatmentNotes} onChange={(event) => setTreatmentNotes(event.target.value)} />
          </label>
          <label>Tipo de pauta
            <select value={scheduleKind} onChange={(event) => setScheduleKind(event.target.value as 'daily' | 'interval')}>
              <option value='daily'>Una o varias horas al día</option>
              <option value='interval'>Cada N horas</option>
            </select>
          </label>
          {scheduleKind === 'daily'
            ? (
              <label>
                Horas (separadas por comas, por ejemplo 08:00, 20:00)
                <input value={dailyTimes} onChange={(event) => setDailyTimes(event.target.value)} required />
              </label>
              )
            : (
              <label>
                Intervalo en horas
                <input type='number' min='1' max='24' step='1' value={intervalHours} onChange={(event) => setIntervalHours(event.target.value)} required />
              </label>
              )}
          <label>Inicio
            <input type='datetime-local' value={startAt} onChange={(event) => setStartAt(event.target.value)} required />
          </label>
          <label>Fin (opcional)
            <input type='datetime-local' value={endAt} onChange={(event) => setEndAt(event.target.value)} />
          </label>
          <button type='submit'>{editingTreatmentId === null ? 'Añadir tratamiento' : 'Guardar cambios'}</button>
          {editingTreatmentId !== null && <button type='button' className='secondary' onClick={() => { setEditingTreatmentId(null); setName(''); setActiveIngredient(''); setInstructions(''); setTreatmentNotes('') }}>Cancelar edición</button>}
        </form>
        {treatments.length === 0
          ? <p className='muted'>Todavía no hay tratamientos.</p>
          : treatments.map((treatment) => (
            <article className='list-row' key={treatment.id}>
              <div>
                <strong>{treatment.name}</strong>
                <p className='muted small'>
                  {treatment.status === 'active' ? 'Activo' : treatment.status === 'paused' ? 'En pausa' : 'Finalizado'}
                </p>
              </div>
              {treatment.status !== 'finished' && (
                <div className='actions'>
                  <button
                    type='button'
                    className='secondary'
                    onClick={() => {
                      setEditingTreatmentId(treatment.id)
                      setName(treatment.name)
                      setActiveIngredient(treatment.activeIngredient ?? '')
                      setInstructions(treatment.instructions ?? '')
                      setTreatmentNotes(treatment.notes ?? '')
                      setScheduleKind(treatment.schedule.kind)
                      setDailyTimes(treatment.schedule.kind === 'daily' ? treatment.schedule.times.join(', ') : '08:00')
                      setIntervalHours(treatment.schedule.kind === 'interval' ? String(treatment.schedule.everyHours) : '8')
                      setStartAt(localDateTimeValue(treatment.startsAt))
                      setEndAt(treatment.endsAt === undefined ? '' : localDateTimeValue(treatment.endsAt))
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type='button'
                    className='secondary'
                    onClick={() => {
                      changeTreatmentStatus(treatment, treatment.status === 'paused' ? 'active' : 'paused').catch(handleError)
                    }}
                  >
                    {treatment.status === 'paused' ? 'Reanudar' : 'Pausar'}
                  </button>
                  <button
                    type='button'
                    className='secondary'
                    onClick={() => {
                      changeTreatmentStatus(treatment, 'finished').catch(handleError)
                    }}
                  >
                    Finalizar
                  </button>
                </div>
              )}
            </article>
          ))}
      </section>
      <section className='card'>
        <h2>Próximas tomas</h2>
        {doseRows.length === 0
          ? <p className='muted'>No hay tomas previstas en los próximos días.</p>
          : doseRows.map(({ treatment, scheduledAt, record }) => (
            <article className='list-row' key={plannedDoseId(treatment.id, scheduledAt)}>
              <div>
                <strong>{treatment.name}</strong>
                <p className='muted small'>
                  {formatDateTime(scheduledAt)} · {record === undefined ? 'Pendiente' : record.status === 'administered' ? 'Administrada' : 'Omitida'}
                </p>
              </div>
              <div className='actions'>
                <button
                  type='button'
                  onClick={() => {
                    markDose(treatment, scheduledAt, 'administered').catch(handleError)
                  }}
                >
                  {record === undefined ? 'Administrada' : 'Corregir a administrada'}
                </button>
                <button
                  type='button'
                  className='secondary'
                  onClick={() => {
                    markDose(treatment, scheduledAt, 'omitted').catch(handleError)
                  }}
                >
                  {record === undefined ? 'Omitir' : 'Corregir a omitida'}
                </button>
              </div>
            </article>
          ))}
        <p className='muted small'>Los avisos push, cuando estén disponibles, pueden llegar hasta una hora antes. No son alarmas médicas de precisión.</p>
      </section>
      <section className='card'>
        <h2>Historial de tomas</h2>
        {doses.length === 0
          ? <p className='muted'>Todavía no hay tomas registradas.</p>
          : [...doses].sort((a, b) => b.recordedAt - a.recordedAt).map((dose) => {
              const treatment = treatments.find((item) => item.id === dose.treatmentId)
              return (
                <article className='list-row' key={dose.id}>
                  <div>
                    <strong>{treatment?.name ?? 'Tratamiento finalizado'}</strong>
                    <p className='muted small'>
                      Prevista: {formatDateTime(dose.scheduledAt)} · {dose.status === 'administered' ? 'Administrada' : 'Omitida'}
                    </p>
                    <p className='muted small'>
                      Registrada: {formatDateTime(dose.recordedAt)} · revisión {dose.revision}
                    </p>
                  </div>
                  {treatment?.status === 'active' && (
                    <div className='actions'>
                      <button
                        type='button'
                        className='secondary'
                        onClick={() => {
                          markDose(treatment, dose.scheduledAt, 'administered').catch(handleError)
                        }}
                      >
                        Corregir a administrada
                      </button>
                      <button
                        type='button'
                        className='secondary'
                        onClick={() => {
                          markDose(treatment, dose.scheduledAt, 'omitted').catch(handleError)
                        }}
                      >
                        Corregir a omitida
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
      </section>
      <section className='card'>
        <h2>Citas médicas</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            saveAppointment().catch(handleError)
          }}
        >
          <label>Motivo o especialista
            <input value={appointmentTitle} onChange={(event) => setAppointmentTitle(event.target.value)} required />
          </label>
          <label>Fecha y hora
            <input type='datetime-local' value={appointmentAt} onChange={(event) => setAppointmentAt(event.target.value)} required />
          </label>
          <label>Centro o lugar (opcional)
            <input value={appointmentPlace} onChange={(event) => setAppointmentPlace(event.target.value)} />
          </label>
          <label>Duración en minutos (opcional)
            <input type='number' min='1' step='1' value={appointmentDuration} onChange={(event) => setAppointmentDuration(event.target.value)} />
          </label>
          <label>Notas o preparación (opcional)
            <input value={appointmentNotes} onChange={(event) => setAppointmentNotes(event.target.value)} />
          </label>
          <button type='submit'>{editingAppointmentId === null ? 'Añadir cita' : 'Guardar cambios'}</button>
          {editingAppointmentId !== null && <button type='button' className='secondary' onClick={() => { setEditingAppointmentId(null); setAppointmentTitle(''); setAppointmentPlace(''); setAppointmentNotes(''); setAppointmentDuration('') }}>Cancelar edición</button>}
        </form>
        {[...appointments].sort((a, b) => a.startsAt - b.startsAt).map((appointment) => (
          <article className='list-row' key={appointment.id}>
            <div>
              <strong>{appointment.title}</strong>
              <p className='muted small'>
                {formatDateTime(appointment.startsAt)}
                {appointment.place ? ` · ${appointment.place}` : ''}
                {' · '}
                {appointment.status === 'scheduled' ? 'Próxima' : appointment.status === 'completed' ? 'Realizada' : 'Cancelada'}
              </p>
            </div>
            <div className='actions'>
              {appointment.status !== 'cancelled' && (
                <button
                  type='button'
                  className='secondary'
                  onClick={() => {
                    setEditingAppointmentId(appointment.id)
                    setAppointmentTitle(appointment.title)
                    setAppointmentAt(localDateTimeValue(appointment.startsAt))
                    setAppointmentPlace(appointment.place ?? '')
                    setAppointmentNotes(appointment.notes ?? '')
                    setAppointmentDuration(appointment.durationMinutes === undefined ? '' : String(appointment.durationMinutes))
                  }}
                >
                  Editar
                </button>
              )}
              {appointment.status === 'scheduled' && (
                <>
                  <button
                    type='button'
                    className='secondary'
                    onClick={() => {
                      changeAppointmentStatus(appointment, 'completed').catch(handleError)
                    }}
                  >
                    Realizada
                  </button>
                  <button
                    type='button'
                    className='secondary'
                    onClick={() => {
                      changeAppointmentStatus(appointment, 'cancelled').catch(handleError)
                    }}
                  >
                    Cancelar
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </section>
      {error !== null && <p role='alert' className='error'>{error}</p>}
    </main>
  )
}
