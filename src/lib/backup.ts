import type {
  Baby,
  DiaperSize,
  Movement,
  MovementType,
  UsageSource,
  WeightRecord,
} from '../../shared/types.ts';
import { db } from '../db/index.ts';

/** Full JSON export of every table (D-19) — the only safety net. */
export async function exportJSON(): Promise<void> {
  const backup = {
    version: 1,
    exportedAt: Date.now(),
    babies: await db.babies.toArray(),
    movements: await db.movements.toArray(),
    weights: await db.weights.toArray(),
    sizes: await db.sizes.toArray(),
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cacotas-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number';

const TYPES: readonly MovementType[] = [
  'INITIAL',
  'PURCHASE',
  'USAGE',
  'ADJUSTMENT',
  'UNDO',
  'SIZE_CHANGE',
];
const SOURCES: readonly UsageSource[] = ['OWN_STOCK', 'EXTERNAL'];

function parseMovement(r: Record<string, unknown>): Movement | null {
  if (!TYPES.includes(r.type as MovementType)) return null;
  if (
    r.usageSource !== undefined &&
    !SOURCES.includes(r.usageSource as UsageSource)
  )
    return null;

  return {
    id: isStr(r.id) ? r.id : "",
    babyId: isStr(r.babyId) ? r.babyId : "",
    sizeId: isNum(r.sizeId) ? r.sizeId : -1,
    type: r.type as MovementType,
    ...(isStr(r.usageSource)
      ? { usageSource: r.usageSource as UsageSource }
      : {}),
    quantity: isNum(r.quantity) ? r.quantity : -1,
    delta: isNum(r.delta) ? r.delta : NaN,
    ...(isStr(r.undoesMovementId) ? { undoesMovementId: r.undoesMovementId } : {}),
    ...(isStr(r.note) ? { note: r.note } : {}),
    occurredAt: isNum(r.occurredAt) ? r.occurredAt : NaN,
    recordedAt: isNum(r.recordedAt) ? r.recordedAt : NaN,
    deviceId: isStr(r.deviceId) ? r.deviceId : '',
    serverSeq: isNum(r.serverSeq) ? r.serverSeq : 0,
  };
}

function parseBaby(r: Record<string, unknown>): Baby {
  return {
    id: isStr(r.id) ? r.id : "",
    name: isStr(r.name) ? r.name : '',
    ...(isStr(r.birthDate) ? { birthDate: r.birthDate } : {}),
    zoneId: isStr(r.zoneId) ? r.zoneId : '',
    createdAt: isNum(r.createdAt) ? r.createdAt : NaN,
    updatedAt: isNum(r.updatedAt) ? r.updatedAt : NaN,
    serverSeq: isNum(r.serverSeq) ? r.serverSeq : 0,
  };
}

function parseWeight(r: Record<string, unknown>): WeightRecord {
  return {
    id: isStr(r.id) ? r.id : "",
    babyId: isStr(r.babyId) ? r.babyId : "",
    weightKg: isNum(r.weightKg) ? r.weightKg : NaN,
    recordedAt: isNum(r.recordedAt) ? r.recordedAt : NaN,
    deviceId: isStr(r.deviceId) ? r.deviceId : '',
    serverSeq: isNum(r.serverSeq) ? r.serverSeq : 0,
  };
}

function parseSize(r: Record<string, unknown>): DiaperSize {
  return {
    id: isNum(r.id) ? r.id : -1,
    name: isStr(r.name) ? r.name : '',
    ...(isNum(r.minWeightKg) ? { minWeightKg: r.minWeightKg } : {}),
    ...(isNum(r.maxWeightKg) ? { maxWeightKg: r.maxWeightKg } : {}),
  };
}

function parseRows<T>(
  rows: unknown,
  parse: (r: Record<string, unknown>) => T,
): T[] | null {
  if (!Array.isArray(rows)) return null;
  const out: T[] = [];
  for (const row of rows) {
    if (!isRecord(row)) return null;
    out.push(parse(row));
  }
  return out;
}

/** Import replaces the whole local database with the file contents. */
export async function importJSON(file: File): Promise<void> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es JSON válido');
  }
  if (!isRecord(parsed)) throw new Error('Formato inesperado');

  const babies = parseRows(parsed.babies, parseBaby);
  const movements = parseRows(parsed.movements, parseMovement);
  const weights = parseRows(parsed.weights, parseWeight);
  const sizes = parseRows(parsed.sizes, parseSize);
  if (
    !babies ||
    !movements ||
    !weights ||
    !sizes ||
    movements.some((m) => m === null)
  ) {
    throw new Error('El archivo no tiene el formato esperado');
  }
  const validMovements: Movement[] = movements.flatMap((m) =>
    m === null ? [] : [m],
  );

  if (
    validMovements.some(
      (m) => m.quantity < 0 || m.sizeId < 0 || !Number.isFinite(m.delta),
    )
  ) {
    throw new Error('El archivo contiene movimientos corruptos');
  }

  await db.transaction(
    'rw',
    db.babies,
    db.movements,
    db.weights,
    db.sizes,
    async () => {
      await Promise.all([
        db.babies.clear(),
        db.movements.clear(),
        db.weights.clear(),
        db.sizes.clear(),
      ]);
      await db.babies.bulkPut(babies);
      await db.movements.bulkPut(validMovements);
      await db.weights.bulkPut(weights);
      await db.sizes.bulkPut(sizes);
    },
  );
}
