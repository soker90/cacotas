import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { createMovement } from '../../shared/factory.ts';
import type { Movement } from '../../shared/types.ts';
import type { Baby } from '../../shared/types.ts';
import { currentSize, stockBySize } from '../db/derive.ts';
import { db } from '../db/index.ts';
import { exportJSON, importJSON } from '../lib/backup.ts';
import { uuid } from '../lib/uuid.ts';
import { getDeviceId } from '../sync/device-id.ts';

const UNDO_WINDOW_MS = 5_000;

export function Home({ baby }: { baby: Baby }) {
  const sizeId = useLiveQuery(() => currentSize(db, baby.id));
  const stocks = useLiveQuery(() => stockBySize(db, baby.id));
  const [lastUsage, setLastUsage] = useState<Movement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function recordDiaper(): Promise<void> {
    if (typeof sizeId !== 'number') return;
    const now = Date.now();
    const movement = createMovement(
      {
        id: uuid(),
        babyId: baby.id,
        sizeId,
        deviceId: getDeviceId(),
        occurredAt: now,
        recordedAt: now,
      },
      { type: 'USAGE', usageSource: 'OWN_STOCK', quantity: 1 },
    );
    await db.movements.add(movement);

    setLastUsage(movement);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setLastUsage(null); }, UNDO_WINDOW_MS);
  }

  async function undoLast(): Promise<void> {
    if (!lastUsage) return;
    if (timer.current) clearTimeout(timer.current);
    const now = Date.now();
    const undo = createMovement(
      {
        id: uuid(),
        babyId: lastUsage.babyId,
        sizeId: lastUsage.sizeId,
        deviceId: getDeviceId(),
        occurredAt: now,
        recordedAt: now,
      },
      { type: 'UNDO', original: lastUsage },
    );
    await db.movements.add(undo);
    setLastUsage(null);
  }

  const stock = sizeId !== null && sizeId !== undefined ? (stocks?.get(sizeId) ?? 0) : null;

  async function onImport(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importJSON(file);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo importar');
    }
    e.target.value = '';
  }

  return (
    <main className="home">
      <header className="home-header">
        <span>
          👶 {baby.name}
          {typeof sizeId === 'number' ? ` · Talla ${String(sizeId)}` : ''}
        </span>
      </header>

      <button
        type="button"
        className="big-button"
        disabled={sizeId === null}
        onClick={() => { void recordDiaper(); }}
      >
        🧷 PAÑAL GASTADO
      </button>

      {lastUsage && (
        <p className="toast" role="status">
          Registrado.{' '}
          <button type="button" onClick={() => { void undoLast(); }}>
            Deshacer
          </button>
        </p>
      )}

      <section className="stock">
        {stock === null ? (
          <p className="muted">Sin talla actual</p>
        ) : (
          <p>
            {stock} pañales
            {stock < 0 && (
              <strong className="warn"> · revisa el inventario</strong>
            )}
          </p>
        )}
      </section>

      <footer className="home-footer">
        <button type="button" onClick={() => { void exportJSON(); }}>
          Exportar JSON
        </button>
        <label className="file-label">
          Importar JSON
          <input type="file" accept="application/json" onChange={(e) => { void onImport(e); }} />
        </label>
      </footer>
    </main>
  );
}
