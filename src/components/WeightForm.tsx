import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { logicalDate } from '../../shared/time.ts'
import type { Baby } from '../../shared/types.ts'
import { db } from '../db/index.ts'
import { getDeviceId } from '../sync/device-id.ts'
import { uuid } from '../lib/uuid.ts'
import { notifyWrite } from '../sync/scheduler.ts'
import { formatLogicalDateEs } from '../lib/format-date.ts'

const parseDecimal = (text: string): number | null => {
  const value = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Soft Home reminder (§8.8): more than 30 days since the last weight. */
export const useWeightReminder = (babyId: string): boolean =>
  (useLiveQuery(async () => {
    const rows = await db.weights.where('babyId').equals(babyId).toArray()
    const last = rows.reduce((max, w) => Math.max(max, w.recordedAt), 0)
    return last === 0 || Date.now() - last > 30 * 86_400_000
  }, [babyId]) ?? false)

/**
 * Weight (and optional length) recording for paediatric visits (§8.8).
 * The help text explains the home-scale trick from the manufacturer guide.
 * Length is stored but unused in the MVP.
 */
export const WeightForm = ({ baby }: { baby: Baby }) => {
  const [open, setOpen] = useState(false)
  const [weightText, setWeightText] = useState('')
  const [lengthText, setLengthText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [savedKg, setSavedKg] = useState<number | null>(null)

  const lastWeight = useLiveQuery(async () => {
    const rows = await db.weights
      .where('babyId')
      .equals(baby.id)
      .sortBy('recordedAt')
    return rows.at(-1) ?? null
  }, [baby.id])

  const save = async (): Promise<void> => {
    const kg = parseDecimal(weightText)
    if (kg === null || kg > 30) {
      setError('El peso debe ser un número mayor que 0 (en kg)')
      return
    }
    const cm =
      lengthText.trim() === '' ? null : parseDecimal(lengthText)
    if (lengthText.trim() !== '' && (cm === null || cm > 150)) {
      setError('La longitud debe ser un número mayor que 0 (en cm)')
      return
    }

    const now = Date.now()
    await db.weights.add({
      id: uuid(),
      babyId: baby.id,
      weightKg: kg,
      ...(cm !== null ? { lengthCm: cm } : {}),
      recordedAt: now,
      deviceId: getDeviceId(),
      serverSeq: 0,
    })
    notifyWrite()
    setError(null)
    setSavedKg(kg)
    setWeightText('')
    setLengthText('')
  }

  return (
    <div className='weight-form'>
      {open
        ? (
          <>
            <p className='muted small'>
              Súbete a la báscula con el bebé desnudo y apunta la cifra.
              Después vuelve a subirte sin él y resta: la diferencia es su
              peso.
            </p>
            <div className='form-row'>
              <label htmlFor='weight-kg'>Peso (kg)</label>
              <input
                id='weight-kg'
                inputMode='decimal'
                value={weightText}
                onChange={(e) => { setWeightText(e.target.value) }}
                placeholder='6,4'
                autoFocus
              />
            </div>
            <div className='form-row'>
              <label htmlFor='weight-length'>Longitud (cm, opcional)</label>
              <input
                id='weight-length'
                inputMode='decimal'
                value={lengthText}
                onChange={(e) => { setLengthText(e.target.value) }}
                placeholder='62'
              />
            </div>
            <button
              type='button'
              className='primary'
              onClick={() => { void save() }}
            >
              Guardar peso
            </button>
          </>
          )
        : (
          <button
            type='button'
            className='btn-neutral'
            onClick={() => { setOpen(true) }}
          >
            ⚖️ Registrar peso
          </button>
          )}

      {error && (
        <p role='alert' className='error'>
          {error}
        </p>
      )}
      {savedKg !== null && (
        <p role='status' className='muted small'>
          Guardado: ≈ {savedKg.toLocaleString('es-ES')} kg
        </p>
      )}
      {!open && savedKg === null && lastWeight !== undefined && lastWeight !== null && (
        <p className='muted small'>
          Último peso: ≈ {lastWeight.weightKg.toLocaleString('es-ES')} kg
          {' · '}
          {formatLogicalDateEs(logicalDate(lastWeight.recordedAt))}
        </p>
      )}
    </div>
  )
}
