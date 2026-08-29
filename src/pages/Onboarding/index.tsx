import { useState } from 'react'
import { createMovement } from '../../../shared/factory.ts'
import { ZONE } from '../../../shared/time.ts'
import type { Baby, Sex } from '../../../shared/types.ts'
import { db } from '../../db/index.ts'
import { getDeviceId } from '../../sync/device-id.ts'
import { uuid } from '../../lib/uuid.ts'
import { notifyWrite } from '../../sync/scheduler.ts'

const parseDecimal = (text: string): number | null => {
  const value = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Three steps, no more (§10): baby data → current size → initial stock.
 * The baby step also collects the fields that feed the size-transition
 * estimators (§8.8): birth date (required), birth weight, sex and, only if
 * born premature, weeks of gestation. Everything but the date can be
 * skipped — each empty field is a null and the model degrades gracefully.
 */
export const Onboarding = () => {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [birthWeightText, setBirthWeightText] = useState('')
  const [sex, setSex] = useState<Sex | null>(null)
  const [premature, setPremature] = useState(false)
  const [weeksText, setWeeksText] = useState('')
  const [sizeId, setSizeId] = useState<number | null>(1) // talla 1 preseleccionada (§10)
  const [stockText, setStockText] = useState('0')
  const [error, setError] = useState<string | null>(null)

  const birthWeightKg = birthWeightText.trim() === ''
    ? null
    : parseDecimal(birthWeightText)

  const gestationalWeeks = premature
    ? (() => {
        const weeks = Number.parseInt(weeksText, 10)
        return Number.isInteger(weeks) && weeks >= 20 && weeks <= 43
          ? weeks
          : undefined
      })()
    : undefined

  const canNext =
    (step === 0 && name.trim().length > 0 && birthDate !== '') ||
    (step === 1 && sizeId !== null) ||
    step === 2

  const finish = async (): Promise<void> => {
    const stock = Number.parseInt(stockText, 10)
    if (!Number.isInteger(stock) || stock < 0) {
      setError('El stock inicial debe ser un número entero mayor o igual a 0')
      return
    }
    if (sizeId === null) return
    if (premature && gestationalWeeks === null) {
      setError('Las semanas de gestación deben ser un número entre 20 y 43')
      setStep(0)
      return
    }
    if (birthWeightText.trim() !== '' && birthWeightKg === null) {
      setError('El peso al nacer debe ser un número mayor que 0')
      setStep(0)
      return
    }

    const now = Date.now()
    const babyId = uuid()
    const deviceId = getDeviceId()
    const baby: Baby = {
      id: babyId,
      name: name.trim(),
      birthDate,
      zoneId: ZONE,
      createdAt: now,
      updatedAt: now,
      serverSeq: 0,
      ...(birthWeightKg !== null ? { birthWeightKg } : {}),
      ...(sex !== null ? { sex } : {}),
      ...(gestationalWeeks !== undefined ? { gestationalWeeks } : {}),
    }

    try {
      const initial = createMovement(
        {
          id: uuid(),
          babyId,
          sizeId,
          deviceId,
          occurredAt: now,
          recordedAt: now,
        },
        { type: 'INITIAL', quantity: stock }
      )
      const sizeChange = createMovement(
        {
          id: uuid(),
          babyId,
          sizeId,
          deviceId,
          occurredAt: now,
          recordedAt: now,
        },
        { type: 'SIZE_CHANGE' }
      )
      // The birth weight is also the first WeightRecord (§8.8)
      const birthWeight =
        birthWeightKg !== null
          ? {
              id: uuid(),
              babyId,
              weightKg: birthWeightKg,
              recordedAt: now,
              deviceId,
              serverSeq: 0,
            }
          : null

      await db.transaction('rw', db.babies, db.movements, db.weights, async () => {
        await db.babies.put(baby)
        await db.movements.bulkAdd([initial, sizeChange])
        if (birthWeight !== null) await db.weights.add(birthWeight)
      })
      // Publish the new Baby right away (§9.7)
      notifyWrite()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    }
  }

  return (
    <main className='onboarding'>
      <h1>Cacotas</h1>
      <p className='muted'>Paso {step + 1} de 3</p>

      {step === 0 && (
        <section>
          <label htmlFor='baby-name'>¿Cómo se llama el bebé?</label>
          <input
            id='baby-name'
            value={name}
            onChange={(e) => { setName(e.target.value) }}
            placeholder='Nombre'
            autoFocus
          />

          <label htmlFor='baby-birth-date'>¿Cuándo nació?</label>
          <input
            id='baby-birth-date'
            type='date'
            value={birthDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => { setBirthDate(e.target.value) }}
          />

          <label htmlFor='baby-birth-weight'>Peso al nacer en kg (opcional)</label>
          <input
            id='baby-birth-weight'
            inputMode='decimal'
            value={birthWeightText}
            onChange={(e) => { setBirthWeightText(e.target.value) }}
            placeholder='3,3'
          />

          <p className='muted small'>Sexo (opcional, afina la estimación de peso)</p>
          <div className='row'>
            <button
              type='button'
              className={sex === 'male' ? 'size selected' : 'size'}
              aria-pressed={sex === 'male'}
              onClick={() => { setSex(sex === 'male' ? null : 'male') }}
            >
              Niño
            </button>
            <button
              type='button'
              className={sex === 'female' ? 'size selected' : 'size'}
              aria-pressed={sex === 'female'}
              onClick={() => { setSex(sex === 'female' ? null : 'female') }}
            >
              Niña
            </button>
          </div>

          <label className='check-row'>
            <input
              type='checkbox'
              checked={premature}
              onChange={(e) => { setPremature(e.target.checked) }}
            />
            ¿Nació antes de tiempo?
          </label>
          {premature && (
            <>
              <label htmlFor='baby-gestational-weeks'>
                Semanas de gestación
              </label>
              <input
                id='baby-gestational-weeks'
                inputMode='numeric'
                value={weeksText}
                onChange={(e) => { setWeeksText(e.target.value) }}
                placeholder='34'
              />
            </>
          )}
        </section>
      )}

      {step === 1 && (
        <section>
          <p>¿Qué talla usáis ahora?</p>
          <div className='size-grid'>
            {Array.from({ length: 7 }, (_, i) => (
              <button
                key={i}
                type='button'
                className={sizeId === i ? 'size selected' : 'size'}
                aria-label={`Talla ${String(i)}`}
                aria-pressed={sizeId === i}
                onClick={() => { setSizeId(i) }}
              >
                {i}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <label htmlFor='initial-stock'>¿Cuántos pañales tenéis en casa?</label>
          <input
            id='initial-stock'
            inputMode='numeric'
            value={stockText}
            onChange={(e) => { setStockText(e.target.value) }}
            placeholder='84'
            autoFocus
          />
        </section>
      )}

      {error && (
        <p role='alert' className='error'>
          {error}
        </p>
      )}

      <div className='row'>
        {step > 0 && (
          <button type='button' onClick={() => { setStep(step - 1) }}>
            Atrás
          </button>
        )}
        {step < 2
          ? (
            <button
              type='button'
              className='primary'
              disabled={!canNext}
              onClick={() => { setStep(step + 1) }}
            >
              Siguiente
            </button>
            )
          : (
            <button
              type='button'
              className='primary'
              disabled={!canNext}
              onClick={() => { void finish() }}
            >
              Empezar
            </button>
            )}
      </div>
    </main>
  )
}
