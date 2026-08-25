import { useState } from 'react';
import { createMovement } from '../../shared/factory.ts';
import { ZONE } from '../../shared/time.ts';
import type { Baby } from '../../shared/types.ts';
import { db } from '../db/index.ts';
import { getDeviceId } from '../sync/device-id.ts';
import { uuid } from '../lib/uuid.ts';

/** Three steps, no more (§10): name → current size → initial stock. */
export const Onboarding = () => {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [sizeId, setSizeId] = useState<number | null>(null);
  const [stockText, setStockText] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const canNext =
    (step === 0 && name.trim().length > 0) ||
    (step === 1 && sizeId !== null) ||
    step === 2;

  const finish = async (): Promise<void> => {
    const stock = Number.parseInt(stockText, 10);
    if (!Number.isInteger(stock) || stock < 0) {
      setError('El stock inicial debe ser un número entero mayor o igual a 0');
      return;
    }
    if (sizeId === null) return;

    const now = Date.now();
    const babyId = uuid();
    const deviceId = getDeviceId();
    const baby: Baby = {
      id: babyId,
      name: name.trim(),
      zoneId: ZONE,
      createdAt: now,
      updatedAt: now,
      serverSeq: 0,
    };

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
        { type: 'INITIAL', quantity: stock },
      );
      const sizeChange = createMovement(
        {
          id: uuid(),
          babyId,
          sizeId,
          deviceId,
          occurredAt: now,
          recordedAt: now,
        },
        { type: 'SIZE_CHANGE' },
      );

      await db.transaction('rw', db.babies, db.movements, async () => {
        await db.babies.put(baby);
        await db.movements.bulkAdd([initial, sizeChange]);
      });
      // The immediate sync that publishes the new Baby arrives in phase 3.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    }
  }

  return (
    <main className="onboarding">
      <h1>Cacotas</h1>
      <p className="muted">Paso {step + 1} de 3</p>

      {step === 0 && (
        <section>
          <label htmlFor="baby-name">¿Cómo se llama el bebé?</label>
          <input
            id="baby-name"
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            placeholder="Nombre"
            autoFocus
          />
        </section>
      )}

      {step === 1 && (
        <section>
          <p>¿Qué talla usáis ahora?</p>
          <div className="size-grid">
            {Array.from({ length: 7 }, (_, i) => (
              <button
                key={i}
                type="button"
                className={sizeId === i ? 'size selected' : 'size'}
                onClick={() => { setSizeId(i); }}
              >
                {i}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <label htmlFor="initial-stock">¿Cuántos pañales tenéis en casa?</label>
          <input
            id="initial-stock"
            inputMode="numeric"
            value={stockText}
            onChange={(e) => { setStockText(e.target.value); }}
            placeholder="84"
            autoFocus
          />
        </section>
      )}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div className="row">
        {step > 0 && (
          <button type="button" onClick={() => { setStep(step - 1); }}>
            Atrás
          </button>
        )}
        {step < 2 ? (
          <button
            type="button"
            className="primary"
            disabled={!canNext}
            onClick={() => { setStep(step + 1); }}
          >
            Siguiente
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={!canNext}
            onClick={() => { void finish(); }}
          >
            Empezar
          </button>
        )}
      </div>
    </main>
  );
}
