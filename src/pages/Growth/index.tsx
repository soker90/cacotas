import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Baby } from '../../../shared/types.ts'
import { db } from '../../db/index.ts'
import { getDeviceId } from '../../sync/device-id.ts'
import { notifyWrite } from '../../sync/scheduler.ts'
import { uuid } from '../../lib/uuid.ts'
import { formatWeightKg } from '../../lib/format-weight.ts'

const localDate = (): string => {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const localDateTime = (): string => {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const formatDate = (timestamp: number): string =>
  new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(timestamp)

export const Growth = ({ baby }: { baby: Baby }) => {
  const weights = useLiveQuery(
    () => db.weights.where('babyId').equals(baby.id).sortBy('recordedAt'),
    [baby.id]
  )
  const heights = useLiveQuery(
    () => db.heightRecords.where('babyId').equals(baby.id).sortBy('recordedAt'),
    [baby.id]
  )
  const [weightText, setWeightText] = useState('')
  const [weightDate, setWeightDate] = useState(localDate)
  const [heightText, setHeightText] = useState('')
  const [heightDate, setHeightDate] = useState(localDateTime)
  const [error, setError] = useState<string | null>(null)

  const saveWeight = async (): Promise<void> => {
    const value = Number(weightText.replace(',', '.'))
    const recordedAt = new Date(`${weightDate}T12:00:00`).getTime()
    if (!Number.isFinite(value) || value < 0.1 || value > 40 || !Number.isFinite(recordedAt)) {
      setError('Introduce un peso válido en kg y una fecha correcta.')
      return
    }
    await db.weights.add({
      id: uuid(),
      babyId: baby.id,
      weightKg: value,
      recordedAt,
      deviceId: getDeviceId(),
      serverSeq: 0,
    })
    notifyWrite()
    setWeightText('')
    setWeightDate(localDate())
    setError(null)
  }

  const saveHeight = async (): Promise<void> => {
    const value = Number(heightText.replace(',', '.'))
    const recordedAt = new Date(heightDate).getTime()
    if (!Number.isFinite(value) || value < 20 || value > 150 || !Number.isFinite(recordedAt)) {
      setError('Introduce una altura válida en cm y una fecha correcta.')
      return
    }
    await db.heightRecords.add({
      id: uuid(),
      babyId: baby.id,
      heightCm: value,
      recordedAt,
      deviceId: getDeviceId(),
      serverSeq: 0,
    })
    notifyWrite()
    setHeightText('')
    setHeightDate(localDateTime())
    setError(null)
  }

  if (weights === undefined || heights === undefined) {
    return <main className='loading'>…</main>
  }

  return (
    <main className='page'>
      <h1>Crecimiento</h1>
      <p className='muted small'>
        Registra el peso y la altura por separado. El peso se utiliza para mejorar
        la previsión de cambio de talla; la altura solo se guarda como histórico.
      </p>

      <section className='card growth-section'>
        <h2>Peso</h2>
        <form
          className='growth-form'
          onSubmit={(event) => {
            event.preventDefault()
            void saveWeight()
          }}
        >
          <label htmlFor='growth-weight'>Peso (kg)</label>
          <input
            id='growth-weight'
            type='number'
            inputMode='decimal'
            min='0.1'
            max='40'
            step='0.001'
            placeholder='Ej. 8,250'
            value={weightText}
            onChange={(event) => setWeightText(event.target.value)}
          />
          <label htmlFor='growth-weight-date'>Fecha del pesaje</label>
          <input
            id='growth-weight-date'
            type='date'
            value={weightDate}
            onChange={(event) => setWeightDate(event.target.value)}
          />
          <button className='primary' type='submit'>Guardar peso</button>
        </form>
        <h3>Histórico de peso</h3>
        {weights.length === 0
          ? <p className='muted small'>Todavía no hay pesos registrados.</p>
          : (
            <ol className='growth-history'>
              {[...weights].reverse().map((record) => (
                <li key={record.id}>
                  <span>{formatDate(record.recordedAt)}</span>
                  <strong>{formatWeightKg(record.weightKg)} kg</strong>
                </li>
              ))}
            </ol>
            )}
      </section>

      <section className='card growth-section'>
        <h2>Altura</h2>
        <form
          className='growth-form'
          onSubmit={(event) => {
            event.preventDefault()
            void saveHeight()
          }}
        >
          <label htmlFor='growth-height'>Altura (cm)</label>
          <input
            id='growth-height'
            type='number'
            inputMode='decimal'
            min='20'
            max='150'
            step='0.1'
            placeholder='Ej. 72,5'
            value={heightText}
            onChange={(event) => setHeightText(event.target.value)}
          />
          <label htmlFor='growth-height-date'>Fecha</label>
          <input
            id='growth-height-date'
            type='datetime-local'
            value={heightDate}
            onChange={(event) => setHeightDate(event.target.value)}
          />
          <button className='primary' type='submit'>Guardar altura</button>
        </form>
        <h3>Histórico de altura</h3>
        {heights.length === 0
          ? <p className='muted small'>Todavía no hay alturas registradas.</p>
          : (
            <ol className='growth-history'>
              {[...heights].reverse().map((record) => (
                <li key={record.id}>
                  <span>{formatDate(record.recordedAt)}</span>
                  <strong>{record.heightCm.toLocaleString('es-ES', { maximumFractionDigits: 1 })} cm</strong>
                </li>
              ))}
            </ol>
            )}
      </section>
      {error && <p role='alert' className='error'>{error}</p>}
    </main>
  )
}
