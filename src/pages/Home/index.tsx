import type { ChangeEvent } from 'react';
import type { Baby } from '../../../shared/types.ts';
import {
  useCurrentSize,
  useRecordMovement,
  useStockBySize,
} from '../../hooks';
import { exportJSON, importJSON } from '../../lib/backup.ts';

export const Home = ({ baby }: { baby: Baby }) => {
  const sizeId = useCurrentSize(baby.id);
  const stocks = useStockBySize(baby.id);
  const { recordDiaper, undoLast, lastUsage } = useRecordMovement(baby.id);

  const stock =
    typeof sizeId === 'number' ? (stocks?.get(sizeId) ?? 0) : null;

  const handleRecordDiaper = (): void => {
    if (typeof sizeId === 'number') void recordDiaper(sizeId);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importJSON(file);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo importar');
    }
    e.target.value = '';
  };

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
        disabled={typeof sizeId !== 'number'}
        onClick={handleRecordDiaper}
      >
        🧷 PAÑAL GASTADO
      </button>

      {lastUsage && (
        <p className="toast" role="status">
          Registrado.{' '}
          <button
            type="button"
            onClick={() => {
              void undoLast();
            }}
          >
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
        <button
          type="button"
          onClick={() => {
            void exportJSON();
          }}
        >
          Exportar JSON
        </button>
        <label className="file-label">
          Importar JSON
          <input
            type="file"
            accept="application/json"
            onChange={(e) => {
              void onImport(e);
            }}
          />
        </label>
      </footer>
    </main>
  );
};
