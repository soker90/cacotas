import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Baby, HeightRecord, WeightRecord } from '../../../shared/types.ts'
import { db } from '../../db/index.ts'
import { getDeviceId } from '../../sync/device-id.ts'
import { notifyWrite } from '../../sync/scheduler.ts'
import { uuid } from '../../lib/uuid.ts'
import { formatWeightKg } from '../../lib/format-weight.ts'

const dateInputValue = (timestamp: number): string => {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const localDate = (): string => dateInputValue(Date.now())

const formatDate = (timestamp: number): string =>
  new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(timestamp)

export const Growth = ({ baby }: { baby: Baby }) => {
  const weights = useLiveQuery(
    () => db.weights.where('babyId').equals(baby.id).filter((record) => record.deleted !== true).sortBy('recordedAt'),
    [baby.id]
  )
  const heights = useLiveQuery(
    () => db.heightRecords.where('babyId').equals(baby.id).filter((record) => record.deleted !== true).sortBy('recordedAt'),
    [baby.id]
  )
  const [weightText, setWeightText] = useState('')
  const [weightDate, setWeightDate] = useState(localDate)
  const [heightText, setHeightText] = useState('')
  const [heightDate, setHeightDate] = useState(localDate)
  const [editingWeightId, setEditingWeightId] = useState<string | null>(null)
  const [editingHeightId, setEditingHeightId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cancelWeightEdit = (): void => {
    setEditingWeightId(null)
    setWeightText('')
    setWeightDate(localDate())
  }

  const cancelHeightEdit = (): void => {
    setEditingHeightId(null)
    setHeightText('')
    setHeightDate(localDate())
  }

  const saveWeight = async (): Promise<void> => {
    const value = Number(weightText.replace(',', '.'))
    const recordedAt = new Date(`${weightDate}T12:00:00`).getTime()
    if (!Number.isFinite(value) || value < 0.1 || value > 40 || !Number.isFinite(recordedAt)) {
      setError('Introduce un peso válido en kg y una fecha correcta.')
      return
    }
    const editingRecord = editingWeightId === null
      ? undefined
      : weights?.find((record) => record.id === editingWeightId)
    if (editingWeightId !== null && editingRecord === undefined) {
      setError('Ese peso ya no está disponible para editarlo.')
      return
    }
    if (editingRecord !== undefined) {
      if (!window.confirm('¿Guardar los cambios de este peso? Se sincronizarán con el otro dispositivo.')) return
      await db.weights.put({
        ...editingRecord,
        weightKg: value,
        recordedAt,
        revision: (editingRecord.revision ?? 1) + 1,
        deleted: false,
        serverSeq: 0,
      })
    } else {
      await db.weights.add({
        id: uuid(),
        babyId: baby.id,
        weightKg: value,
        recordedAt,
        deviceId: getDeviceId(),
        serverSeq: 0,
        revision: 1,
        deleted: false,
      })
    }
    notifyWrite()
    cancelWeightEdit()
    setError(null)
  }

  const startWeightEdit = (record: WeightRecord): void => {
    setEditingWeightId(record.id)
    setWeightText(String(record.weightKg))
    setWeightDate(dateInputValue(record.recordedAt))
    setError(null)
  }

  const deleteWeight = async (record: WeightRecord): Promise<void> => {
    if (!window.confirm('¿Borrar este peso del histórico? El cambio se sincronizará con el otro dispositivo.')) return
    await db.weights.put({
      ...record,
      revision: (record.revision ?? 1) + 1,
      deleted: true,
      serverSeq: 0,
    })
    notifyWrite()
    if (editingWeightId === record.id) cancelWeightEdit()
    setError(null)
  }

  const saveHeight = async (): Promise<void> => {
    const value = Number(heightText.replace(',', '.'))
    const recordedAt = new Date(`${heightDate}T12:00:00`).getTime()
    if (!Number.isFinite(value) || value < 20 || value > 150 || !Number.isFinite(recordedAt)) {
      setError('Introduce una altura válida en cm y una fecha correcta.')
      return
    }
    const editingRecord = editingHeightId === null
      ? undefined
      : heights?.find((record) => record.id === editingHeightId)
    if (editingHeightId !== null && editingRecord === undefined) {
      setError('Esa altura ya no está disponible para editarla.')
      return
    }
    if (editingRecord !== undefined) {
      if (!window.confirm('¿Guardar los cambios de esta altura? Se sincronizarán con el otro dispositivo.')) return
      await db.heightRecords.put({
        ...editingRecord,
        heightCm: value,
        recordedAt,
        revision: (editingRecord.revision ?? 1) + 1,
        deleted: false,
        serverSeq: 0,
      })
    } else {
      await db.heightRecords.add({
        id: uuid(),
        babyId: baby.id,
        heightCm: value,
        recordedAt,
        deviceId: getDeviceId(),
        serverSeq: 0,
        revision: 1,
        deleted: false,
      })
    }
    notifyWrite()
    cancelHeightEdit()
    setError(null)
  }

  const startHeightEdit = (record: HeightRecord): void => {
    setEditingHeightId(record.id)
    setHeightText(String(record.heightCm))
    setHeightDate(dateInputValue(record.recordedAt))
    setError(null)
  }

  const deleteHeight = async (record: HeightRecord): Promise<void> => {
    if (!window.confirm('¿Borrar esta altura del histórico? El cambio se sincronizará con el otro dispositivo.')) return
    await db.heightRecords.put({
      ...record,
      revision: (record.revision ?? 1) + 1,
      deleted: true,
      serverSeq: 0,
    })
    notifyWrite()
    if (editingHeightId === record.id) cancelHeightEdit()
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
          <button className='primary' type='submit'>{editingWeightId === null ? 'Guardar peso' : 'Guardar cambios'}</button>
          {editingWeightId !== null && (
            <button className='btn-neutral' type='button' onClick={cancelWeightEdit}>Cancelar edición</button>
          )}
        </form>
        <h3>Histórico de peso</h3>
        {weights.length === 0
          ? <p className='muted small'>Todavía no hay pesos registrados.</p>
          : (
            <ol className='growth-history'>
              {[...weights].reverse().map((record) => (
                <li key={record.id}>
                  <div className='growth-history-value'>
                    <span>{formatDate(record.recordedAt)}</span>
                    <strong>{formatWeightKg(record.weightKg)} kg</strong>
                  </div>
                  <div className='growth-history-actions'>
                    <button className='btn-neutral' type='button' onClick={() => { startWeightEdit(record) }}>Editar</button>
                    <button className='btn-neutral' type='button' onClick={() => { void deleteWeight(record) }}>Borrar</button>
                  </div>
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
          <label htmlFor='growth-height-date'>Fecha de medición</label>
          <input
            id='growth-height-date'
            type='date'
            value={heightDate}
            onChange={(event) => setHeightDate(event.target.value)}
          />
          <button className='primary' type='submit'>{editingHeightId === null ? 'Guardar altura' : 'Guardar cambios'}</button>
          {editingHeightId !== null && (
            <button className='btn-neutral' type='button' onClick={cancelHeightEdit}>Cancelar edición</button>
          )}
        </form>
        <h3>Histórico de altura</h3>
        {heights.length === 0
          ? <p className='muted small'>Todavía no hay alturas registradas.</p>
          : (
            <ol className='growth-history'>
              {[...heights].reverse().map((record) => (
                <li key={record.id}>
                  <div className='growth-history-value'>
                    <span>{formatDate(record.recordedAt)}</span>
                    <strong>{record.heightCm.toLocaleString('es-ES', { maximumFractionDigits: 1 })} cm</strong>
                  </div>
                  <div className='growth-history-actions'>
                    <button className='btn-neutral' type='button' onClick={() => { startHeightEdit(record) }}>Editar</button>
                    <button className='btn-neutral' type='button' onClick={() => { void deleteHeight(record) }}>Borrar</button>
                  </div>
                </li>
              ))}
            </ol>
            )}
      </section>
      {error && <p role='alert' className='error'>{error}</p>}
    </main>
  )
}
