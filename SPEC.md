# Cacotas — Especificación técnica

> Documento único y autosuficiente. Todo lo necesario para implementar el proyecto sin contexto
> previo. Los issues de GitHub son el seguimiento; **este documento es la fuente de verdad**.

---

## 1. Qué es

PWA offline-first para gestionar el inventario de pañales de un bebé y predecir cuándo hay que
comprar más.

Dos padres registran cada pañal desde sus móviles Android. La app lleva el stock por talla,
calcula el consumo diario real y avisa **con 7 días de antelación** de cuándo comprar — evitando
recomendar una talla que el bebé va a dejar de usar antes de agotarla.

**Uso privado.** Sin cuentas, sin registro, sin multi-tenancy. Dos dispositivos, un bebé (modelo
preparado para dos).

**Restricciones:** coste 0 €. Fecha límite fija (el parto).

### Principios de diseño

1. **Todo funciona sin conexión.** La red solo sirve para que los dos móviles converjan. Ninguna
   operación del usuario depende de ella.
2. **Ledger append-only.** Nunca `UPDATE`, nunca `DELETE`. El estado se deriva de los eventos.
3. **Honestidad ante la falta de datos.** Nunca inventar una cifra. "Estamos aprendiendo el
   patrón" es una respuesta válida.
4. **El usuario tiene razón.** La talla la fija él, los ajustes de inventario se respetan, el
   stock negativo se avisa pero no se bloquea.

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Cliente | React + TypeScript + Vite + `vite-plugin-pwa` |
| BD local | Dexie (IndexedDB) |
| Reactividad | `dexie-react-hooks` (`useLiveQuery`) |
| Estáticos | Netlify o GitHub Pages — **fuera de Cloudflare** (§11) |
| Sync | Cloudflare Worker + D1 |
| Auth | Secreto compartido en cabecera `X-Auth` |

### Estructura de carpetas

```
/shared          Tipos y lógica pura compartidos cliente ↔ Worker
  types.ts
  time.ts
  factory.ts
  forecast.ts
  transition.ts
/src             Cliente React
  db/            index.ts · derive.ts (tocan Dexie, por eso NO van en /shared)
  ui/
  sync/
/worker          Cloudflare Worker
  index.ts
  schema.sql
```

`/shared` **no importa nada de React, Dexie ni del entorno de Workers.** Es TypeScript puro y
testeable con `vitest` sin ningún mock.

**No existe ninguna carpeta `domain/`.** La lógica pura vive en `/shared`; lo que toca la base de
datos vive en `/src/db`.

---

## 3. Decisiones cerradas

Cada una con su motivo. **No revisitar sin motivo nuevo.**

| ID | Decisión | Motivo |
|---|---|---|
| D-01 | PWA, no Android nativo | Stack conocido; Android desde cero no cabe en el plazo |
| D-02 | Ledger append-only | Dos dispositivos sobre un `quantity` mutable pierden actualizaciones en silencio (*lost update*). Con inserciones no hay conflicto posible |
| D-03 | UUID generados en cliente | Autoincremental colisionaría entre dispositivos |
| D-04 | `quantity` y `delta` separados | Permite eventos con `delta = 0` (D-05) |
| D-05 | `usageSource: OWN_STOCK \| EXTERNAL` | Pañales del hospital/abuelos: cuentan en histórico, no en stock, no en forecast |
| D-06 | Talla actual manual, como evento | El usuario decide. La app deriva la talla del último `SIZE_CHANGE` |
| D-07 | Zona horaria del bebé | `Europe/Madrid` fijo. Si un móvil viaja, ambos deben agrupar igual |
| D-08 | El día empieza a las 06:00 | El pañal de las 3 AM pertenece a la noche anterior |
| D-09 | Stock negativo permitido | Un registro que no se puede hacer es información perdida para siempre |
| D-10 | `occurredAt` ≠ `recordedAt` | Uno coloca el evento en su día; el otro detecta registro a posteriori |
| D-11 | Deshacer = movimiento inverso | Evita el borrado distribuido. Un solo camino para todos los tipos |
| D-12 | Consumo agregado por bebé | Por talla, la app quedaría ciega justo al cambiar de talla |
| D-13 | Días sin registro se excluyen | Un bebé nunca gasta 0 pañales en un día: es dato ausente, no cero |
| D-14 | `warningDays=7`, `coverageDays=21` | 7 encaja con la compra semanal; 21 evita volver a zona de aviso enseguida |
| D-15 | El bloqueo por talla nunca aplica bajo 7 días | Evita dejar a un padre sin pañales un domingo por consejo de la app |
| D-16 | Cursor de sync = `seq` del servidor | Con relojes desfasados, filtrar por fecha pierde filas para siempre |
| D-17 | Idempotencia por UUID | La red móvil corta constantemente entre guardar y confirmar |
| D-18 | Resistencia a bloqueos de LaLiga | Ver §11 |
| D-19 | Export JSON desde el día 1 | Única red de seguridad |
| D-20 | Botón físico = Fase 2 | Ver §13 |
| D-21 | El consumo del recién nacido decrece rápido | 10-12/día → 5-6 a los 6 meses. Ventanas largas sobreestiman |
| D-22 | El registro es irregular y a posteriori | A las 4 AM no se registra nada; se meten 3 de golpe por la mañana |
| D-23 | Multi-bebé en el modelo, uno en la UI | `babyId` en todo, sin selector por ahora |
| D-24 | Transición de talla: tres estimadores combinados por el mínimo | Señales observadas, proyección de peso y tiempo en la talla (§8). Funciona desde el día 1 sin registrar ningún peso —gracias a la duración típica por talla de la tabla Dodot— y mejora sola con cada peso registrado. Solo bloquea compras con confianza `MEDIUM`+, por la asimetría del coste de error (§8.6). Sustituye a la extrapolación por peso que estaba en "fuera de alcance": se descartó cuando la alternativa era el histórico de tallas, que no existe el día del estreno |
| D-25 | La incertidumbre se muestra, no se esconde | La transición se presenta siempre como un rango (*"entre 5 y 10 semanas"*), nunca como una cifra puntual. Con más pesos registrados el rango se estrecha, de modo que el usuario ve que la app está aprendiendo en vez de confiar en una falsa precisión. Para decidir compras se usa el extremo pesimista (§8.9) |

---

## 4. Modelo de datos

### 4.1 Tipos (`shared/types.ts`)

```ts
export type UUID = string;

export type MovementType =
  | 'INITIAL' | 'PURCHASE' | 'USAGE'
  | 'ADJUSTMENT' | 'UNDO' | 'SIZE_CHANGE';

export type UsageSource = 'OWN_STOCK' | 'EXTERNAL';

export interface Movement {
  id: UUID;
  babyId: UUID;
  sizeId: number;                 // 0..7

  type: MovementType;
  usageSource?: UsageSource;      // obligatorio si type === 'USAGE'

  quantity: number;               // >= 0 — para estadísticas
  delta: number;                  // efecto en stock — puede ser 0 o negativo

  undoesMovementId?: UUID;        // obligatorio si type === 'UNDO'
  note?: string;

  occurredAt: number;             // epoch ms — cuándo pasó
  recordedAt: number;             // epoch ms — cuándo se registró

  deviceId: string;
  serverSeq?: number;             // undefined = pendiente de subir
}

export interface Baby {
  id: UUID;
  name: string;
  birthDate?: string;             // 'YYYY-MM-DD' — se pide en el onboarding (§10)
  zoneId: string;                 // 'Europe/Madrid'
  birthWeightKg?: number;         // también se registra como primer WeightRecord (§8.8)
  sex?: 'male' | 'female';        // factor de ganancia de peso (§8.8)
  gestationalWeeks?: number;      // semanas de gestación; se asume 40 (a término)
  createdAt: number;
  updatedAt: number;              // last-write-wins al sincronizar
  serverSeq?: number;
}

export interface WeightRecord {
  id: UUID;
  babyId: UUID;
  weightKg: number;
  lengthCm?: number;              // se guarda, no se usa en el MVP (§8.8)
  recordedAt: number;
  deviceId: string;
  serverSeq?: number;
}

export interface DiaperSize {
  id: number;                     // 0..7 = número de talla
  name: string;                   // 'Talla 2'
  minWeightKg?: number;
  maxWeightKg?: number;
  dailyDiapers?: number;          // consumo medio de fabricante (siembra §7.2)
  typicalMonths?: number;         // duración típica de la talla (§8.4)
}

/** Señales manuales de que la talla se queda pequeña (guía Dodot, §8.3). */
export interface TransitionSignals {
  tabsNotCentered: boolean;       // las cintas no llegan al centro de la cintura
  noTwoFingers: boolean;          // no caben dos dedos bajo la cintura cerrada
  redMarks: boolean;              // deja marcas rojas en barriga o muslos
  uncoveredButtocks: boolean;     // el pañal no le cubre del todo las nalgas
  frequentDermatitis: boolean;    // dermatitis del pañal frecuente
  pullsDiaper: boolean;           // se muestra molesto o tira del pañal
}
```

### 4.2 Tabla de verdad de `quantity` / `delta`

| Evento | quantity | delta |
|---|---|---|
| Stock inicial 84 | 84 | +84 |
| Compra de 60 | 60 | +60 |
| Pañal propio | 1 | −1 |
| **Pañal externo (hospital)** | **1** | **0** |
| Ajuste 54 → 51 | 3 | −3 |
| Cambio de talla | 0 | 0 |
| Deshacer consumo propio | 1 | +1 |
| Deshacer consumo externo | 1 | 0 |

### 4.3 Validaciones (`shared/factory.ts`)

**Único punto de creación de movimientos.** Garantiza coherencia venga del cliente, del Worker
o del botón físico.

```
Siempre:          quantity >= 0, sizeId ∈ [0,7], occurredAt <= recordedAt + 60s

type=USAGE        usageSource definido, quantity >= 1
  OWN_STOCK       delta = -quantity
  EXTERNAL        delta = 0
type=PURCHASE     quantity >= 1, delta = +quantity
type=INITIAL      quantity >= 0, delta = +quantity, máximo uno por (babyId, sizeId)
type=ADJUSTMENT   quantity = abs(delta), delta ≠ 0
type=UNDO         undoesMovementId definido, delta = -original.delta,
                  quantity = original.quantity
type=SIZE_CHANGE  quantity = 0, delta = 0
```

Cualquier violación lanza excepción. No hay creación de movimientos fuera de la factory.

> ⚠️ `ADJUSTMENT` guarda una **diferencia**, no un valor absoluto. Deshacer un ajuste revierte
> el delta; no restaura el número que había. La UI debe decir *"revertir el ajuste"*, nunca
> *"volver a 54"*.

### 4.4 Esquema Dexie (`src/db/index.ts`)

```ts
this.version(1).stores({
  movements: 'id, babyId, occurredAt, serverSeq, undoesMovementId, ' +
             '[babyId+occurredAt], [babyId+type], [babyId+sizeId]',
  babies:    'id',
  weights:   'id, babyId, recordedAt, serverSeq',
  sizes:     'id'
});
```

Nombre de la base: `cacotas`.

**Instalación nueva** — `version(1)`: sembrar las tallas 0-7 a partir de `DODOT_SIZES` (§8.2):
nombre, rangos de peso, `dailyDiapers` y `typicalMonths`. Rangos y medias son editables por el
usuario (§8.8).

**Migración de las bases existentes** — las bases de la fase 1 sembraron tallas 0-6 sin datos,
así que `version(2).upgrade()` debe:

- Insertar la **talla 7**, que no existía en la siembra original
- Rellenar en las tallas 0-6 los campos ausentes (`minWeightKg`, `maxWeightKg`, `dailyDiapers`,
  `typicalMonths`) desde `DODOT_SIZES`
- **Nunca sobrescribir un valor ya definido**: el usuario pudo haber editado sus rangos
- No tocar los movimientos (D-02)

La migración se verifica sobre una **base v1 con datos** — movimientos, pesos, una talla con el
rango editado — nunca sobre una base vacía (§15).

### 4.5 Esquema D1 (`worker/schema.sql`)

```sql
CREATE TABLE movements (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- cursor, lo asigna el servidor
  id         TEXT NOT NULL UNIQUE,               -- UUID del cliente → idempotencia
  baby_id    TEXT NOT NULL,
  size_id    INTEGER NOT NULL,
  type       TEXT NOT NULL,
  usage_source TEXT,
  quantity   INTEGER NOT NULL,
  delta      INTEGER NOT NULL,
  undoes_movement_id TEXT,
  note       TEXT,
  occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  device_id  TEXT NOT NULL
);
CREATE INDEX idx_movements_seq ON movements(seq);

CREATE TABLE weights (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  baby_id    TEXT NOT NULL,
  weight_kg  REAL NOT NULL,
  length_cm  REAL,                  -- se guarda, no se usa en el MVP (§8.8)
  recorded_at INTEGER NOT NULL,
  device_id  TEXT NOT NULL
);

CREATE TABLE babies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  birth_date TEXT,
  zone_id    TEXT NOT NULL,
  birth_weight_kg REAL,              -- datos de transición de talla (§8.8)
  sex        TEXT,
  gestational_weeks INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  device_id  TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL,
  keys_json  TEXT NOT NULL
);

CREATE TABLE notification_log (
  baby_id    TEXT NOT NULL,
  size_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  state_hash TEXT NOT NULL,      -- para no repetir si nada cambió
  sent_at    INTEGER NOT NULL,
  snoozed_until INTEGER,         -- "me encargo yo"
  PRIMARY KEY (baby_id, size_id, kind)
);
```

---

## 5. Tiempo (`shared/time.ts`)

```ts
export const ZONE = 'Europe/Madrid';
export const DAY_START_HOUR = 6;

/** Fecha lógica 'YYYY-MM-DD'. El día empieza a las 06:00 (D-08). */
export function logicalDate(epochMs: number, zone = ZONE): string {
  const shifted = epochMs - DAY_START_HOUR * 3_600_000;
  return new Intl.DateTimeFormat('sv-SE', { timeZone: zone })
    .format(new Date(shifted));       // 'sv-SE' produce formato ISO
}

/** Días naturales entre dos fechas lógicas. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
```

**Agrupar siempre en JS, nunca en SQL ni en IndexedDB.** Con los cambios de hora de marzo y
octubre, la aritmética sobre epoch se rompe.

---

## 6. Derivaciones (`src/db/derive.ts`)

Ninguna de estas magnitudes se almacena. Todas se calculan.

```ts
/** Stock por talla = suma de deltas. */
export async function stockBySize(babyId: UUID): Promise<Map<number, number>>

/** Talla actual = sizeId del último SIZE_CHANGE por occurredAt. null si no hay ninguno. */
export async function currentSize(babyId: UUID): Promise<number | null>

/** Consumos no deshechos desde una fecha. */
export async function liveUsage(babyId: UUID, from: number): Promise<Movement[]>

/** Duración en días de cada talla ya cerrada, desde los SIZE_CHANGE consecutivos. */
export async function sizeDurations(babyId: UUID): Promise<Map<number, number>>
```

Un movimiento está *deshecho* si existe un `UNDO` cuyo `undoesMovementId` apunta a él. Los
movimientos deshechos y sus `UNDO` se ocultan en el historial, pero **ambos siguen en la base de
datos** (D-02).

En React, envolver con `useLiveQuery` para reactividad automática — el stock se actualiza igual
si el cambio viene del propio móvil o del sync.

---

## 7. Motor de forecast (`shared/forecast.ts`)

Módulo **puro**: sin base de datos, sin red, sin React. Compartido entre cliente y Worker.

### 7.1 Interfaz

```ts
export interface ForecastInput {
  stock: number;                    // de la talla evaluada
  usage: Movement[];                // consumos vivos de TODAS las tallas (D-12)
  currentSize: DiaperSize | null;   // para la siembra en frío (§7.2)
  now: number;
  transition: TransitionEstimate | null;   // estimación de transición (§8)
  warningDays: number;              // 7
  coverageDays: number;             // 21
  diapersPerPackage?: number;
}

export type Confidence = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

/** Estimación de transición de talla producida por §8. */
export interface TransitionEstimate {
  days: number;                     // días estimados hasta el cambio
  confidence: Confidence;           // nunca NONE: sin datos el estimador devuelve null
}

export type ForecastStatus =
  | 'NO_DATA'              // sin historial suficiente
  | 'OK'                   // hay margen
  | 'BUY_NOW'              // stock bajo, comprar
  | 'BUY_BOTH_SIZES'       // stock bajo y cambio de talla próximo
  | 'HOLD_SIZE_CHANGE';    // no comprar: cambiará de talla antes de agotarlo

export interface Forecast {
  dailyConsumption: number | null;
  daysRemaining: number | null;
  exhaustionDate: string | null;    // 'YYYY-MM-DD'
  confidence: Confidence;
  variabilityHigh: boolean;
  daysCovered: number;              // días con registro usados
  seeded: boolean;                  // consumo semillado de fabricante (§7.2)
  status: ForecastStatus;
  recommendedDiapers: number | null;
  recommendedPackages: number | null;
}
```

La UI renderiza el texto a partir de `status`. **El motor no devuelve cadenas de texto.**

### 7.2 Cálculo del consumo diario

```ts
export function dailyConsumption(
  usage: Movement[],
  currentSize: DiaperSize | null,   // talla evaluada, para la siembra en frío
  now: number
) {
  // 1. Solo stock propio (D-05)
  const own = usage.filter(m => m.usageSource === 'OWN_STOCK');

  // 2. Agrupar por día lógico
  const byDay = new Map<string, number>();
  for (const m of own) {
    const d = logicalDate(m.occurredAt);
    byDay.set(d, (byDay.get(d) ?? 0) + m.quantity);
  }

  // 3. Excluir el día en curso (D-13): a las 10:00 llevas 2 y hundiría la media
  byDay.delete(logicalDate(now));

  // 4. Los días sin registro NO están en el mapa, y así se quedan.
  //    No se rellenan con 0: son datos ausentes, no ceros (D-13)
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  // 5. Arranque en frío (§7.2.1): sin ningún día con registro, se siembra con la
  //    media de fabricante de la talla actual. Cifra publicada y etiquetada, no inventada
  if (days.length === 0) {
    const seed = currentSize?.dailyDiapers;
    if (!seed) return null;
    return { value: seed, daysCovered: 0, coverage: 0,
             variabilityHigh: false, seeded: true };
  }

  const counts = days.map(([, n]) => n);
  const last7  = counts.slice(-7);
  const last3  = counts.slice(-3);

  // 6. Estimador: mediana, robusta a días parcialmente registrados (D-22)
  let value: number;
  if (days.length >= 7)      value = 0.4 * median(last3) + 0.6 * median(last7);
  else if (days.length >= 3) value = median(counts);
  else                       value = mean(counts);

  // 7. Cobertura: cuántos de los días naturales del periodo tienen registro
  const span = daysBetween(days[0][0], days.at(-1)![0]) + 1;
  const coverage = days.length / span;

  // 8. Variabilidad
  const variabilityHigh = counts.length >= 3 &&
    stdev(last7) / median(last7) > 0.4;

  return { value, daysCovered: days.length, coverage, variabilityHigh, seeded: false };
}
```

> **Nota de diseño.** La versión anterior de la especificación proponía un EWMA con half-life de
> 5 días. Se descarta: al eliminar los días sin registro, la serie queda irregularmente
> espaciada y el EWMA se vuelve ambiguo (¿decae por hueco natural o por índice?). La mezcla de
> medianas `0.4·mediana(3) + 0.6·mediana(7)` reacciona igual a la tendencia, es robusta a
> valores atípicos, y no admite dos interpretaciones distintas.

#### 7.2.1 Reglas del arranque en frío

- `confidence` = `LOW` siempre que `seeded === true`, con o sin ajustes de §7.3
- **Nunca bloquea una compra** — misma asimetría de §8.6
- **Sí genera recomendación de compra**: errar comprando de más es el lado barato
- En cuanto haya al menos un día con registro, el dato real sustituye al de fabricante
  (solo se siembra con `days.length === 0`); con 3+ días la confianza sube (§7.3)
- La UI dice *"estimación del fabricante"*, nunca una cifra a secas

> **Coherencia con D-13.** D-13 dice *"nunca inventar una cifra"*. Usar una media publicada por
> el fabricante, etiquetada como tal y con confianza `LOW`, **no es inventarla**. Lo que D-13
> prohíbe es presentar una estimación como si fuera un dato medido.

> **Nota de calibración.** Las cifras de Dodot son *"hasta N"*, es decir, cotas superiores.
> Otras fuentes citan 10-12 pañales/día en recién nacidos frente a los 9 de la talla 1. Como
> sobreestimar el consumo lleva a comprar de más —el error barato—, no se corrige al alza.

### 7.3 Confianza

```
daysCovered = 0, sin semilla → NONE
daysCovered = 0, semillado   → LOW   (§7.2.1 — el semillado nunca sube de nivel)
daysCovered 1-2            → LOW
daysCovered 3-13           → MEDIUM
daysCovered >= 14          → HIGH

Bajar un nivel si variabilityHigh
Bajar un nivel si coverage < 0.6   (muchos días sin registrar en el periodo)
```

Nunca baja por debajo de `LOW` si hay algún dato.

### 7.4 Días restantes y recomendación

```ts
daysRemaining  = Math.floor(stock / daily)
exhaustionDate = logicalDate(now + daysRemaining * 86_400_000)

const lowStock = stock <= daily * warningDays;

// Faltante para alcanzar la cobertura deseada, descontando lo que ya hay
recommendedDiapers  = Math.max(0, Math.ceil(daily * coverageDays) - stock)
recommendedPackages = diapersPerPackage
  ? Math.ceil(recommendedDiapers / diapersPerPackage)
  : null
```

**Primero pañales, después paquetes** — así funciona con paquetes de 30, 44, 60 o 72.

### 7.5 Determinación del `status`

Este bloque es el corazón de la app. Orden de evaluación estricto:

```ts
if (daily === null)                    return 'NO_DATA';

const transitionFirst =
  transition !== null && transition.days < daysRemaining;

// D-24 / §8.6: el bloqueo exige confianza de transición MEDIUM o superior.
// La media poblacional (LOW) avisa, pero no bloquea. Con consumo semillado
// (§7.2) tampoco se bloquea: el propio forecast está en LOW.
const canHold =
  transition !== null &&
  (transition.confidence === 'MEDIUM' || transition.confidence === 'HIGH') &&
  !daily.seeded;

if (lowStock && transitionFirst)       return 'BUY_BOTH_SIZES';
if (lowStock)                          return 'BUY_NOW';
if (transitionFirst && canHold)        return 'HOLD_SIZE_CHANGE';
return 'OK';

// D-15: HOLD_SIZE_CHANGE solo se alcanza sin stock bajo, es decir, con
// daysRemaining > warningDays. El bloqueo NUNCA aplica con <= 7 días,
// sea cual sea la confianza — no hay rama que lo permita.
```

Textos que debe mostrar la UI:

| status | Texto |
|---|---|
| `NO_DATA` | *Estamos aprendiendo el patrón de consumo.* |
| `OK` | *Quedan ≈ N días.* |
| `BUY_NOW` | *Conviene comprar pañales de talla N.* |
| `BUY_BOTH_SIZES` | *Queda poco stock y el cambio de talla se acerca: compra un paquete pequeño de la talla N y otro de la N+1.* |
| `HOLD_SIZE_CHANGE` | *No parece conveniente comprar más talla N. Es probable que paséis a la N+1 antes de agotarlos.* |

Si `confidence` es `LOW`, añadir *"predicción poco fiable todavía"*.
Si `variabilityHigh`, añadir *"el consumo es irregular"*.
Si el consumo está semillado (`seeded`, §7.2), anteponer *"estimación del fabricante:"* a la
cifra — *Estimación del fabricante: ≈ 9 pañales al día.* Nunca una cifra a secas.

Mostrar siempre *"aproximadamente 12 días"*, **nunca** `11,99923`.

---

## 8. Transición de talla (`shared/transition.ts`)

Módulo **puro**: sin BD, sin red, sin React. Compartido entre cliente y Worker.

Datos de referencia: guía oficial de tallas Dodot (P&G, abril 2025) y guías de crecimiento OMS.
**Marca de referencia del proyecto: Dodot.**

### 8.1 Principio

El usuario cambia de talla a mano (D-06). Este módulo **solo produce una estimación** de cuándo
va a tocar, que alimenta `transition` en el forecast (§7).

**Esto es una heurística de producto, no una recomendación médica.** La app nunca presenta un
peso como "recomendado" ni valora si el crecimiento del bebé es adecuado. Cualquier duda sobre
el peso del bebé es del pediatra.

Tres estimadores independientes, combinados por el **mínimo**:

```ts
transition = min(signalDays, weightDays, durationDays)   // por days
```

El mínimo es correcto porque cualquiera de los tres solo puede significar "antes de lo que
creías". La confianza resultante es la del estimador que produjo el mínimo; **si dos empatan en
días, gana la confianza más alta** — el resultado no puede depender del orden del array. Cada
uno se degrada a `null` si le faltan datos, y el modelo sigue funcionando con los demás.

### 8.2 Datos semilla — tabla Dodot

Van en `DiaperSize` como valores por defecto **editables** (§4.1, §4.4). Nunca presentados como
recomendación médica: son rangos y medias de fabricante.

```ts
export const DODOT_SIZES = [
  { id: 0, name: 'Talla 0', minWeightKg: 1.5, maxWeightKg:  2.5, dailyDiapers: 10, typicalMonths: 1.6 },
  { id: 1, name: 'Talla 1', minWeightKg: 2.0, maxWeightKg:  5.0, dailyDiapers:  9, typicalMonths: 1.7 },
  { id: 2, name: 'Talla 2', minWeightKg: 4.0, maxWeightKg:  8.0, dailyDiapers:  8, typicalMonths: 2.8 },
  { id: 3, name: 'Talla 3', minWeightKg: 6.0, maxWeightKg: 10.0, dailyDiapers:  7, typicalMonths: 5.8 },
  { id: 4, name: 'Talla 4', minWeightKg: 9.0, maxWeightKg: 15.0, dailyDiapers:  7, typicalMonths: 6.8 },
  { id: 5, name: 'Talla 5', minWeightKg: 11.0, maxWeightKg: 17.0, dailyDiapers: 6, typicalMonths: 5.0 },
  { id: 6, name: 'Talla 6', minWeightKg: 13.0, maxWeightKg: null, dailyDiapers: 6, typicalMonths: 5.8 },
  { id: 7, name: 'Talla 7', minWeightKg: 17.0, maxWeightKg: null, dailyDiapers: 6, typicalMonths: 4.1 },
];
```

> **Nota:** la propia guía de Dodot es internamente inconsistente — la tabla dice talla 5
> "11-17 kg" mientras el texto dice "por encima de 12 kg". Se usa la tabla, que es el dato
> estructurado. En cualquier caso los rangos son editables por el usuario.

La talla 0 (1,5-2,5 kg) cubre prematuros y bajo peso al nacer: es la única que el onboarding no
sugiere por defecto — ahí se propone la talla 1 (§10).

### 8.3 Señales manuales

Seis señales, tomadas literalmente de la guía Dodot. En el detalle de talla, casillas que el
usuario marca cuando lo observa:

```
☐ Las cintas no llegan al centro de la cintura
☐ No caben dos dedos bajo la cintura cerrada
☐ Le deja marcas rojas en barriga o muslos
☐ El pañal no le cubre del todo las nalgas
☐ Dermatitis del pañal frecuente
☐ Se muestra molesto o tira del pañal
```

```ts
export function signalDays(signals: TransitionSignals): TransitionEstimate | null {
  const n = countTrue(signals);
  if (n === 0) return null;
  if (n === 1) return { days: 3, confidence: 'MEDIUM' };
  return { days: 0, confidence: 'HIGH' };   // dos o más: cambiar ya
}
```

**El umbral.** Una sola señal ya justifica plantear la talla siguiente (`MEDIUM`): una marca
roja no es una predicción, es piel irritada ahora. Dos o más (`HIGH`) significan cambiar ya.

**Los escapes no son señal.** No son fiables: Dodot los describe como consecuencia tanto de un
pañal demasiado pequeño (falta de absorción) como de uno demasiado grande (se sale antes de
absorber). Un escape aislado no distingue entre las dos causas. Si se conservan en la interfaz,
es como pregunta secundaria que no puntúa por sí sola:

```
Hay escapes frecuentes → ¿le quedan marcas o cuesta cerrarlo?
                          Sí → cuenta como señal
                          No → podría ser al revés: el pañal le queda grande
```

**Señal inversa, para completar:** si las cintas **se superponen**, el pañal es demasiado
grande. Útil si alguien sube de talla antes de tiempo.

Las señales se guardan por `(babyId, sizeId)` en `localStorage` y se limpian al cambiar de
talla. No se sincronizan (§17).

### 8.4 Estimador por tiempo en la talla

**El más valioso: funciona desde el día 1 sin registrar ningún peso.** Solo necesita la fecha
del último `SIZE_CHANGE`, que ya está en el ledger (§6).

```ts
export function durationDays(
  sizeStartedAt: number,
  size: DiaperSize,
  now: number
): TransitionEstimate | null {

  if (!size.typicalMonths) return null;

  const elapsed  = (now - sizeStartedAt) / 86_400_000;
  const expected = size.typicalMonths * 30.44;

  return {
    days: Math.max(0, Math.floor(expected - elapsed)),
    confidence: 'LOW',    // media poblacional: nunca basta para bloquear (§8.6)
  };
}
```

Confianza siempre `LOW`: es una media de población, y la variación individual es grande.

### 8.5 Estimador por peso

#### Ganancia poblacional (OMS)

```ts
const WEEKLY_GAIN_G = [
  { untilWeeks: 6,   grams: 175 },   // 0-6 sem   (rango 140-250)
  { untilWeeks: 17,  grams: 150 },   // 6 sem-4 m (rango 100-200)
  { untilWeeks: 26,  grams: 115 },   // 4-6 m     (rango  80-150)
  { untilWeeks: 52,  grams:  60 },   // 6-12 m    (rango  40- 80)
  { untilWeeks: 999, grams:  40 },
];

export const weeklyGainG = (ageWeeks: number) =>
  WEEKLY_GAIN_G.find(r => ageWeeks < r.untilWeeks)!.grams;

const SEX_FACTOR = { male: 1.05, female: 0.95, unknown: 1.0 };
```

#### Edad en semanas — sobre días naturales

`weeksSince` y `weeksBetween` se calculan sobre **días naturales entre fechas lógicas** (§5),
nunca dividiendo milisegundos: con el cambio de hora de marzo y octubre el truncado falla.

```ts
/** Semanas de edad sobre fechas lógicas: DST-safe. */
export const weeksSince = (birthDate: string, now: number): number =>
  daysBetween(birthDate, logicalDate(now)) / 7;

/** Semanas entre dos instantes, también sobre fechas lógicas. */
export const weeksBetween = (from: number, to: number): number =>
  daysBetween(logicalDate(from), logicalDate(to)) / 7;

/** Edad corregida para prematuros: toda la tabla de crecimiento se desplaza (§8.8). */
export function correctedAgeWeeks(
  birthDate: string, gestationalWeeks: number, now: number
): number {
  const chrono = weeksSince(birthDate, now);
  return Math.max(0, chrono - (40 - gestationalWeeks));
}
```

#### Peso objetivo: punto medio del solapamiento

Los rangos Dodot se solapan mucho (T1: 2-5, T2: 4-8, T3: 6-10). Esperar al máximo llega tarde;
en la práctica se cambia dentro de la zona común.

```ts
export function targetWeightKg(current: DiaperSize, next: DiaperSize | null): number | null {
  if (!current.maxWeightKg) return null;
  if (!next?.minWeightKg)   return current.maxWeightKg;
  return (next.minWeightKg + current.maxWeightKg) / 2;
}
```

**Validación contra los datos de Dodot:**

| Cambio | Rangos | Objetivo | Duración calculada | Dodot dice |
|---|---|---|---|---|
| T1 → T2 | 2-5 / 4-8 | 4,5 kg | 1,6 meses | **1,7** ✅ |
| T2 → T3 | 4-8 / 6-10 | 7,0 kg | 3,8 meses | 2,8 ⚠️ |
| T3 → T4 | 6-10 / 9-15 | 9,5 kg | ~5 meses | 5,8 ✅ |

El segundo se desvía un mes. Por eso los tres estimadores se combinan por el mínimo: donde el
peso llega tarde, el tiempo en la talla corrige.

#### Estimación del peso actual

```ts
export function estimateWeightKg(
  weights: WeightRecord[],       // ordenados por recordedAt
  baby: Pick<Baby, 'birthDate' | 'sex' | 'gestationalWeeks'>,
  now: number
): { kg: number; personal: boolean } | null {

  if (!baby.birthDate) return null;   // sin fecha no hay edad, no hay proyección (§10)

  const last = weights.at(-1);
  if (!last) return null;

  const ageWeeks = correctedAgeWeeks(baby.birthDate, baby.gestationalWeeks ?? 40, now);

  // ⚠️ Las 2 primeras semanas el bebé PIERDE peso (descenso fisiológico)
  // antes de recuperarlo. Proyectar aquí da resultados falsos.
  if (ageWeeks < 2) return null;

  const elapsed = weeksBetween(last.recordedAt, now);
  const { g: gain, observed } = currentGainG(weights, baby, now);

  return { kg: last.weightKg + (gain * elapsed) / 1000, personal: observed };
}

/** Ganancia real g/semana entre los dos últimos pesos, si son fiables. */
function observedGainG(weights: WeightRecord[]): number | null {
  if (weights.length < 2) return null;
  const [a, b] = weights.slice(-2);
  const weeks = weeksBetween(a.recordedAt, b.recordedAt);
  if (weeks < 1) return null;                  // intervalo corto: ruido de báscula
  const g = ((b.weightKg - a.weightKg) * 1000) / weeks;
  if (g <= 0 || g > 400) return null;          // implausible: error de medida
  return g;
}

/**
 * Mejor estimación de la ganancia semanal (g): la observada del propio bebé si
 * es fiable; si no, la tabla poblacional ajustada por sexo.
 *
 * ⚠️ SEX_FACTOR se aplica aquí, y SOLO aquí: es el único punto del módulo que
 * ajusta la ganancia. Ni la proyección de peso ni el cálculo de días vuelven a
 * multiplicar — una doble aplicación daría 175 × 1,05² en vez de 175 × 1,05.
 */
function currentGainG(
  weights: WeightRecord[],
  baby: Pick<Baby, 'birthDate' | 'sex' | 'gestationalWeeks'>,
  now: number
): { g: number; observed: boolean } {
  const observed = observedGainG(weights);
  if (observed !== null) return { g: observed, observed: true };
  const ageWeeks = correctedAgeWeeks(baby.birthDate!, baby.gestationalWeeks ?? 40, now);
  return { g: weeklyGainG(ageWeeks) * SEX_FACTOR[baby.sex ?? 'unknown'], observed: false };
}

export function weightDays(
  weights: WeightRecord[],
  baby: Pick<Baby, 'birthDate' | 'sex' | 'gestationalWeeks'>,
  current: DiaperSize, next: DiaperSize | null, now: number
): TransitionEstimate | null {

  const est = estimateWeightKg(weights, baby, now);
  const target = targetWeightKg(current, next);
  if (!est || target === null) return null;

  const confidence = est.personal ? 'MEDIUM' : 'LOW';
  if (est.kg >= target) return { days: 0, confidence };

  // Misma tasa que estimateWeightKg: si la estimación era personal (ganancia
  // observada), los días restantes se calculan con ESA tasa, no con la tabla
  const { g: gain } = currentGainG(weights, baby, now);
  return {
    days: Math.floor((target - est.kg) / (gain / 7000)),
    confidence,
  };
}
```

**Degradación:**

| Datos | Comportamiento |
|---|---|
| Sin `birthDate` | `null` — quedan señales y tiempo en talla |
| Sin pesos | `null` — quedan señales y tiempo en talla |
| Edad < 2 semanas | `null` — descenso fisiológico |
| 1 peso | Tabla poblacional — `LOW` |
| 2+ pesos | Ganancia observada del propio bebé — `MEDIUM` |

### 8.6 Regla de asimetría — la más importante

**Equivocarse hacia arriba y hacia abajo no cuesta lo mismo:**

- Predecir el cambio demasiado pronto → se bloquea la compra → **os quedáis sin pañales**
- Predecir demasiado tarde → se compra de más → **sobran veinte pañales**

> **Solo se puede bloquear una compra (`HOLD_SIZE_CHANGE`) con confianza `MEDIUM` o superior.**

En la práctica eso significa: al menos una señal marcada (`MEDIUM`+), o dos pesos reales
registrados (`MEDIUM`). La media poblacional por sí sola (`LOW`) **avisa pero no bloquea**, y
el arranque en frío del forecast (§7.2.1) tampoco bloquea nunca.

Sigue vigente **D-15**: el bloqueo nunca aplica con `daysRemaining <= 7`, sea cual sea la
confianza (§7.5).

Motivo: la variabilidad entre bebés llega a 100 g/semana en dos desviaciones típicas. Sobre un
objetivo de 7 kg eso son semanas de error — insuficiente para decirle a alguien que no compre.

### 8.7 Convertir la estimación en un hecho

```
¿Le queda pequeño el pañal?
Lleva 7 semanas con la talla 2 y su peso estimado es ≈ 6,8 kg.

[ Sí, cambiar a talla 3 ]   [ Todavía no ]
```

- **"Sí"** → registra el `SIZE_CHANGE` (evento del ledger, ya existente)
- **"Todavía no"** → silencia el aviso 14 días

Máximo una vez cada 14 días, y solo si `transition.days <= 7`. El prompt vive en el detalle de
talla (§10). El snooze se guarda en `localStorage`, como las señales: **no se sincroniza**,
así que cada padre ve y silencia el aviso por su lado (§17).

### 8.8 Parámetros que se piden al usuario

| Dato | Dónde | Cuándo | Efecto si falta |
|---|---|---|---|
| Fecha de nacimiento | Onboarding | Una vez | Sin estimador de peso (§8.5) |
| Peso al nacer | Onboarding | Una vez | Se registra como primer `WeightRecord` |
| Sexo | Onboarding | Una vez | Factor neutro (×1,0) |
| Semanas de gestación | Onboarding | Solo si nació antes de tiempo | Se asume 40 (a término) |
| Peso actual | Home / detalle de talla | Cada visita al pediatra | Proyección poblacional |
| Longitud | Junto al peso, opcional | Cada visita | Ninguno en el MVP |
| Señales | Detalle de talla | Cuando se observen | Sin estimador de señales |
| Rangos y medias por talla | Ajustes → tallas | Precargados Dodot | Sin estimadores de peso/tiempo |

#### Sexo

Las tablas OMS difieren: los niños ganan algo más rápido en los primeros meses.

```ts
// Dentro de currentGainG (§8.5): el único punto donde SEX_FACTOR se aplica
weeklyGainG(correctedAgeWeeks(...)) * SEX_FACTOR[baby.sex ?? 'unknown']
```

Un toque en el onboarding. Mejora modesta pero gratuita.

#### Semanas de gestación — ⚠️ crítico si aplica

Con un prematuro, **toda la tabla de crecimiento se desplaza**. Se usa `correctedAgeWeeks`
(§8.5) en lugar de la edad cronológica en **todos** los cálculos del estimador de peso. Con un
bebé a término (40 semanas) no cambia nada, así que el caso normal no se ve afectado.

Preguntar solo: *"¿nació antes de tiempo?"* → si sí, pedir semanas. Un campo que casi nadie
rellenará y que para quien lo necesita cambia el modelo entero.

#### Longitud

Cuando pesan al bebé en el pediatra también lo miden: capturarla es gratis. En el MVP **se
guarda pero no se usa**. Aporta lo que el peso no capta — dos bebés de 7 kg, uno largo y delgado
y otro compacto, no llevan la misma talla.

`WeightRecord` gana `lengthCm?: number` (§4.1). Se sincroniza, no se muestra.

#### Descartados a propósito

| Parámetro | Por qué no |
|---|---|
| Percentil | Se deriva de peso + edad + sexo. No aporta señal nueva |
| Tipo de lactancia | La divergencia aparece a partir de los 4-6 meses y es modesta |
| Marca del pañal | Ya lo cubren los rangos editables por talla |
| Perímetro craneal | Sin relación con el ajuste del pañal |

**Un parámetro solo mejora el modelo si aporta señal independiente Y el usuario lo rellena.**
Un campo vacío es un `null`. Con un recién nacido en casa, la mayoría de campos opcionales se
quedan vacíos.

#### Cómo pesar en casa

Texto de ayuda, de la guía Dodot: súbete a la báscula con el bebé desnudo, apunta la cifra,
vuelve a subirte sin él y resta.

**Recordatorio suave:** si han pasado más de 30 días sin registrar peso, mostrar en la Home
*"¿cuánto pesa ya?"*. Sin insistir, sin push.

### 8.9 Presentación honesta — mostrar rangos, no cifras

**La predicción nunca es fiable del todo, y eso debe verse en pantalla.** Devolver "23 días"
proyecta una precisión que no existe (D-25).

La ganancia de peso tiene una desviación típica de unos **50 g/semana**. Aplicándola:

```ts
const SD_GAIN_G = 50;

export function weightDaysRange(...): { min: number; max: number; mid: number } | null {
  const gain = currentGainG(weights, baby, now).g;   // misma tasa que weightDays → mid === days
  const need = target - estimated;              // kg que faltan

  return {
    min: Math.floor(need / ((gain + SD_GAIN_G) / 7000)),   // crece rápido
    mid: Math.floor(need / (gain / 7000)),
    max: Math.floor(need / ((gain - SD_GAIN_G) / 7000)),   // crece lento
  };
}
```

Ejemplo: faltan 1,2 kg con ganancia de 175 g/semana → cifra puntual 48 días, rango honesto
**de 5 a 10 semanas**.

#### Reglas de presentación

- Mostrar **el rango**: *"probablemente entre 5 y 10 semanas"*, nunca *"48 días"*
- Con dos pesos reales el rango se estrecha solo → el usuario **ve** que la app aprende
- Para la **decisión de compra** se usa `max` (el pesimista, el que dice que tardará más):
  errar comprando de más es el lado barato (§8.6)
- El peso siempre como estimación: *"≈ 6,8 kg"*, nunca *"6,8 kg"*
- Con confianza `LOW`, añadir *"estimación aproximada, registra un peso para afinarla"*
- Con dos o más pesos: *"según su ritmo de crecimiento"*
- **Nunca** valorar si el crecimiento es adecuado, ni comparar con percentiles
- **Nunca** presentar los rangos de talla como recomendación médica: son de fabricante

#### Ayuda visual del ajuste

Las cuatro comprobaciones de ajuste (cintura bajo el ombligo, huecos de las piernas sin
holgura, dos dedos bajo la cintura, sin marcas rojas) son **visuales**: en texto se entienden
mal.

⚠️ **No copiar las imágenes de Dodot ni de ningún fabricante — son material con copyright.**

Dos opciones válidas:
- Enlace externo *"cómo comprobar el ajuste"* a la guía del fabricante
- **Recomendado:** un SVG propio y sencillo, cuatro iconos con las cuatro comprobaciones.
  Funciona sin conexión, que encaja con una app offline-first

Los casos de test del módulo están en §15 (`transition.ts`).

---

## 9. Sincronización

### 9.1 Contrato

```
POST /sync
Headers: X-Auth: <secreto>
```

```ts
interface SyncRequest {
  deviceId: string;
  since: number;               // último serverSeq conocido; 0 = todo
  movements: Movement[];       // pendientes de subir
  weights: WeightRecord[];
  baby?: Baby;                 // si cambió localmente
}

interface SyncResponse {
  cursor: number;              // seq máximo devuelto en esta respuesta
  hasMore: boolean;            // true si quedan filas por bajar
  movements: Movement[];
  weights: WeightRecord[];
  baby?: Baby;
  accepted: UUID[];            // ids que el servidor confirma tener
}
```

**Códigos de respuesta:**

| Código | Significado | Acción del cliente |
|---|---|---|
| 200 | OK | Procesar |
| 401 | Secreto inválido | No reintentar. Log |
| 400 | Payload inválido | No reintentar. Log |
| 5xx / red | Fallo temporal | Reintentar con backoff |

### 9.2 Reglas del servidor

- `INSERT OR IGNORE` sobre `id UNIQUE` → idempotencia (D-17). La red móvil corta constantemente
  entre guardar y confirmar; el reintento no debe duplicar.
- `accepted` incluye **también los ignorados**: si ya estaban, están.
- Bajada: `SELECT * FROM movements WHERE seq > ? ORDER BY seq LIMIT 500`
- `hasMore = (filas devueltas === 500)`
- `baby` se resuelve por last-write-wins sobre `updated_at`
- **Validar todo movimiento entrante con la factory** antes de insertarlo

### 9.3 Reglas del cliente

**El cursor a guardar es el `seq` máximo de las filas recibidas, nunca el máximo global** (D-16):

```ts
const newCursor = res.movements.length
  ? Math.max(...res.movements.map(m => m.serverSeq!))
  : since;
```

Guardar el máximo global mientras se pagina haría que las filas intermedias no se bajaran nunca.

**Orden obligatorio dentro de una transacción de Dexie:**

1. Insertar lo remoto (`bulkPut`, idempotente por id)
2. Marcar como sincronizado lo confirmado en `accepted`

Al revés, un fallo entre ambos pasos deja movimientos marcados como subidos que en realidad no
se bajaron. Ese hueco no se recupera nunca.

Si `hasMore`, encadenar otra llamada inmediatamente.

**Disparadores:**
- Al abrir la app
- Tras cada escritura, con debounce de 3 s
- Periódico cada 15 min mientras la app esté abierta
- Backoff exponencial con tope de 30 min

> Un bloqueo de LaLiga de 5 horas debe suponer ~20 intentos, no 300.

**Estado en la UI:** indicador discreto *"sincronizado hace X"*. **Nunca un error rojo** — un
fallo de sync no es un fallo para el usuario.

### 9.4 Endpoint de movimiento suelto

Para el botón físico (D-20, §13). Debe existir desde el principio aunque no se use.

```
POST /movement
Headers: X-Auth: <secreto>
Body: { "type": "USAGE", "usageSource": "OWN_STOCK", "deviceId": "boton-cambiador" }
```

El servidor rellena `id` (UUID nuevo), `sizeId` (último `SIZE_CHANGE`), `babyId` (el único que
haya), `quantity: 1`, `delta: -1`, `occurredAt` y `recordedAt` (ahora).

**Debounce de 60 s por `deviceId`:** si llega otra petición del mismo dispositivo antes, se
ignora y se devuelve 200. Sin confirmación inmediata la gente pulsa de más.

### 9.5 Abstracción

```ts
export interface SyncBackend {
  sync(req: SyncRequest): Promise<SyncResponse>;
}
```

Implementaciones: `HttpSyncBackend` y `FakeSyncBackend` (en memoria, para tests). Permite
cambiar de proveedor sin tocar el resto — la base de datos completa está en ambos móviles, así
que basta con resetear cursores a 0 y se repuebla sola.

---

### 9.6 Identidad del dispositivo

`deviceId` es un UUID generado la primera vez que arranca la app y persistido en `localStorage`
bajo la clave `cacotas.deviceId`. No se pide al usuario y no cambia nunca.

Si `localStorage` se borra, el dispositivo genera un `deviceId` nuevo. No pasa nada: solo sirve
para trazabilidad y para el debounce del botón físico. Los movimientos ya subidos siguen
identificados por su propio UUID.

### 9.7 Arranque y unión de dispositivos

**Crítico.** Sin esto, el segundo móvil crea un bebé distinto y acabáis con dos inventarios
paralelos que nunca se juntan.

Al arrancar, si **no existe ningún `Baby` local**:

```
1. ¿Hay secreto de sync configurado?
   NO  → ir a onboarding (primer dispositivo, sin backend todavía)

2. Intentar POST /sync con since = 0
   Falla la red → ofrecer: [ Reintentar ]  [ Empezar de cero ]
                  "Empezar de cero" solo debe elegirse en el primer dispositivo

3. ¿La respuesta trae un Baby?
   SÍ  → adoptarlo junto con todos sus movimientos.
         SALTAR EL ONBOARDING por completo. Ir directo a Home.
   NO  → ir a onboarding (es el primer dispositivo)
```

Al terminar el onboarding, sincronizar inmediatamente para publicar el `Baby` recién creado.

**Salvaguarda:** si al sincronizar llegan movimientos con un `babyId` distinto del local, **no
mezclarlos**. Mostrar un aviso ("se ha detectado otro bebé en el servidor") y parar. Es señal de
que alguien completó el onboarding dos veces, y mezclar los datos empeoraría el problema.

### 9.8 Modelo de seguridad

**El secreto `X-Auth` viaja en el bundle público y es legible por cualquiera que abra el
JavaScript.** Los estáticos están en un hosting público, así que no hay forma de ocultarlo.

Se acepta a sabiendas: la superficie de ataque es una URL de Worker que nadie conoce, y el daño
posible es alterar un contador de pañales. **No hay datos sensibles.**

Si se quiere más protección: pedir el secreto una sola vez al instalar y guardarlo en
`localStorage` en vez de compilarlo. Fuera del alcance del MVP.

**Sí es obligatorio:** el secreto nunca en git, ni siquiera en un commit revertido. Se inyecta
como variable de entorno en el build.

### 9.9 Desfase de reloj

`occurredAt` lo pone el dispositivo, así que un móvil con la hora mal colocará pañales en el día
lógico equivocado y ensuciará las estadísticas.

- El **sync es inmune**: el cursor es el `seq` del servidor, no una fecha (D-16).
- El **forecast no lo es**: un desfase de horas mueve registros de día.
- Mitigación mínima: la factory rechaza `occurredAt > recordedAt + 60s` (nada del futuro).
- Un desfase de días queda **fuera de alcance**. Ambos móviles usan hora automática de red.

## 10. Pantallas

```
/onboarding          si no existe Baby Y no hay uno en el servidor (§9.7)
/                    Home
/inventory           Inventario
/inventory/:sizeId   Detalle de talla
/history             Historial
/stats               Estadísticas
/settings            Ajustes
```

### `/onboarding` — 3 pasos, no más

Nombre → talla actual → stock inicial. Crea `Baby`, un `INITIAL` y un `SIZE_CHANGE`.

El selector de talla arranca con la **talla 1 preseleccionada**: la 0 (1,5-2,5 kg) es para
prematuros o bajo peso, y quien la necesita la elige a mano.

En el paso del bebé se piden además los datos que alimentan la transición de talla (§8.8):
**fecha de nacimiento** (obligatoria), peso al nacer, sexo y *"¿nació antes de tiempo?"*
(semanas de gestación si la respuesta es sí). Todos menos la fecha se pueden saltar: cada
campo vacío es un `null` y el modelo degrada solo esa parte. El peso al nacer se registra
además como primer `WeightRecord`.

Es una pantalla que se usa una sola vez y cada paso extra es fricción antes de ver valor:
por eso los datos del bebé se agrupan en el primer paso y nada es un bloqueo duro.

### `/` — Home

Es la pantalla que se abre 10 veces al día. Prioridad absoluta al registro.

```
┌────────────────────────────┐
│ 👶 Mateo · Talla 2         │
├────────────────────────────┤
│                            │
│      🧷 PAÑAL GASTADO      │   ← botón grande, usable con una mano
│                            │
├────────────────────────────┤
│ 84 pañales · ≈ 12 días     │
│ [barra de confianza]       │
├────────────────────────────┤
│ 🛒 Recomendación / aviso   │
├────────────────────────────┤
│ sincronizado hace 4 h      │   ← discreto, gris
└────────────────────────────┘
```

- Un toque registra `USAGE` / `OWN_STOCK` de la talla actual
- Confirmación efímera con **[ Deshacer ]** (5 s)
- Si el "modo estancia" está activo, indicador visible y el botón registra `EXTERNAL`
- Acceso secundario al registro múltiple
- Recordatorio suave (§8.8): si han pasado más de 30 días sin registrar peso,
  *"¿cuánto pesa ya?"*. Sin insistir, sin push
- Si el consumo está semillado (§7.2), la cifra se etiqueta *"estimación del fabricante"*

### Registro múltiple

```
Cantidad:  [ − ]  3  [ + ]
Talla:     [1][2✓][3][4][5][6]
Cuándo:    [ ahora ▾ ]
☐ No son nuestros
           [ Registrar ]
```

El selector de fecha escribe `occurredAt`; `recordedAt` es siempre el instante actual (D-10).

> **El +N importa más que el toque instantáneo** (D-22). A las 4 de la mañana no se registra
> nada; se meten 3 de golpe por la mañana.

### `/inventory`

Lista de tallas con stock, días estimados y ajuste rápido `[−] 84 [+]`.
Stock negativo → fila en color de aviso con *"revisa el inventario"*. **No se bloquea nada**
(D-09).

### `/inventory/:sizeId`

Stock, consumo diario, últimos 7/14 días, estimación de transición en rango (§8.9), fecha de
agotamiento, confianza. Casillas de señales de transición (§8.3): las seis de la guía Dodot,
con los escapes como pregunta secundaria que no puntúa sola. Registro de peso —y longitud,
opcional— para las visitas al pediatra (§8.8). Ayuda visual del ajuste: SVG propio con las
cuatro comprobaciones (§8.9).

Prompt de confirmación (§8.7) cuando `transition.days <= 7`: *"¿le queda pequeño?"* →
**[ Sí, cambiar ]** registra el `SIZE_CHANGE`; **[ Todavía no ]** silencia el aviso 14 días
(en `localStorage`, sin sincronizar — §17).

Acciones: añadir compra, ajustar inventario, **cambiar a esta talla**.

> El botón de cambio de talla debe ser fácil de encontrar (D-21): la talla 1 puede durar tres
> semanas, así que se usa pronto y a menudo.

Al cambiar de talla, avisar si queda stock de la anterior: *"te quedan 23 de la talla 2"*.

### `/history`

Cronológico agrupado por día lógico. Distinguir visualmente los `EXTERNAL`. Ocultar movimientos
deshechos y sus `UNDO`. Acción de deshacer por fila.

### `/stats`

Hoy, ayer, 7/14/30 días con su media. Gráfica de consumo diario (calculada, nunca almacenada).
Marcar los días sin registro para saber dónde no fiarse.

### `/settings`

`warningDays`, `coverageDays`, hora de notificación, modo estancia, gestión de tallas, export e
import JSON.

### Estados transversales

Toda pantalla que muestre predicciones debe contemplar: sin datos, cargando, stock cero, stock
negativo y predicción poco fiable. **Nunca inventar una cifra.**

---

## 11. PWA y resistencia a bloqueos

Los bloqueos de IPs de Cloudflare por parte de LaLiga tumban servicios legítimos en España los
fines de semana desde las 14:00, y no se esperan cambios hasta 2027.

Como el registro es local, esto **solo puede afectar al arranque de la app**. Por eso:

```ts
VitePWA({
  registerType: 'prompt',            // NO 'autoUpdate'
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    navigateFallback: 'index.html',
    runtimeCaching: []               // nada va a la red para arrancar
  }
})
```

- **Precachear el shell completo.** Nada de rutas cargadas bajo demanda.
- **Navegación cache-first siempre.** La red solo para `/sync`.
- `registerType: 'prompt'` — con `autoUpdate`, un fallo de red al comprobar versión puede dejar
  un estado inconsistente.
- Un fallo de `/sync` **no puede romper nada visualmente**.
- Alojar los estáticos fuera de Cloudflare. Solo el sync queda expuesto, y ya asumimos que
  puede retrasarse horas sin consecuencias.
- Un dominio propio **no ayuda**: el bloqueo es por IP.

### 🚦 Prueba de aceptación obligatoria

Instalar la PWA → **modo avión** → abrir → registrar 3 pañales → cerrar del todo → reabrir →
los datos siguen ahí.

**Si esto falla, el proyecto no puede continuar tal como está diseñado.** Debe ejecutarse al
final de la primera fase, no al final del proyecto.

---

## 12. Notificaciones

Web Push con VAPID, disparadas por un cron diario del Worker a las 20:00 `Europe/Madrid`.
El cron usa el mismo motor de forecast de `/shared`.

| Tipo | Cuándo | Canal |
|---|---|---|
| `STOCK_LOW` | `daysRemaining <= warningDays` | Push |
| `PURCHASE_RECOMMENDED` | `status === 'BUY_NOW'` o `BUY_BOTH_SIZES` | Push |
| `SIZE_CHANGE_APPROACHING` | `transition !== null && transition.days <= 7` (§8.7) | Solo en la app |
| `HOLD_SIZE_CHANGE` | — | **Nunca push.** Solo en la app |

### Anti-spam

- Máximo **1 por tipo y talla cada 24 h**
- No repetir si `state_hash` no ha cambiado — evita el aviso diario idéntico
- Acción **"me encargo yo"** → escribe `snoozed_until` y silencia el aviso **en ambos móviles**

> Sin lo último, ambos padres reciben el aviso, ambos compran cuatro paquetes, y a la segunda
> semana se abandona la app.

**A considerar:** anclar el aviso de compra a un día fijo (jueves por la tarde) en vez de
dispararlo al cruzar el umbral. Un aviso de martes se olvida antes del sábado, que es cuando se
hace la compra grande. Menos preciso, más útil.

---

## 13. Observabilidad

| Herramienta | Para qué | Desde |
|---|---|---|
| Sentry | Errores del cliente en ambos móviles | Fase 5 |
| healthchecks.io | Heartbeat del cron de notificaciones | Fase 5 |

**Motivo:** con una PWA instalada en dos dispositivos que no controlas, un fallo en el móvil de
la otra persona es invisible. No hay consola ni forma de pedir una traza.

Reglas: el DSN de Sentry va por variable de entorno del build; cada evento se etiqueta con
`deviceId`; **nunca se envían datos del bebé** (nombre, fechas, pesos) en el contexto del error.

El cron hace ping al heartbeat al terminar correctamente. Sin ping en 26 h, aviso por email — un
cron que deja de ejecutarse en silencio significa quedarse sin pañales sin haber recibido ningún
aviso.

## 14. Fase 2 (post-parto, no bloqueante)

### Botón físico

Un tercer dispositivo escribiendo en el ledger. **No requiere cambios de arquitectura**: solo el
endpoint de §9.4.

**Shelly Button 1** (~20 €): `POST` directo, LED de confirmación integrado, batería recargable.

Los Dash Button de Amazon funcionan vía sniffing de ARP en la red local (no dependen de los
servidores de Amazon, que están apagados desde 2019), pero la pila **no es reemplazable** y
aguanta ~1000-2000 pulsaciones. A 10 pañales/día son 3.650 al año: mueren en meses y sin avisar.

### Dashboard (decisión 2026-08-29: no hay dashboard aparte)

El dashboard standalone de esta sección **se descarta**: no se construirá como producto
separado. Lo que aportaba va **dentro de la propia app** (issue #9 reconvertido):

- Consumo diario en el tiempo → ya existe en `/stats` (gráfica de 30 días, §10)
- Media móvil de 7 días → añadir a la gráfica de `/stats` (muestra la curva descendente del
  primer año, D-21)
- **Duración real de cada talla** derivada de los `SIZE_CHANGE` (`sizeDurations`, §6) →
  mostrar en `/stats`; el dato con más valor a largo plazo

---

## 15. Tests

### Unitarios sobre `/shared` — sin mocks

**`time.ts`**
- Pañal a las 03:00 cuenta en el día anterior
- Cambio de hora de marzo y de octubre

**`factory.ts`**
- Cada regla de validación rechaza lo que debe
- `EXTERNAL` produce `delta = 0` con `quantity = 1`
- `UNDO` de un `EXTERNAL` produce `delta = 0`
- `UNDO` de una compra de 60 produce `delta = -60`
- `sizeId = 7` es válido; `sizeId = 8` lanza excepción (§4.3: rango [0,7])

**`forecast.ts`**

| Caso | Esperado |
|---|---|
| stock 70, consumo 7/día | 10 días |
| stock 0 | 0 días |
| sin historial, talla con `dailyDiapers` | 9/día (talla 1), `LOW`, `seeded: true` |
| sin historial, talla sin `dailyDiapers` | `NO_DATA` |
| solo pañales `EXTERNAL` | consumo semillado (`seeded: true`) — sin días propios no hay dato real (D-05) |
| 3 días de historial | dato real, `seeded: false` |
| `seeded` + cambio de talla próximo | **no** bloquea la compra |
| días sin registro intercalados | no hunden la media |
| un día con 1 registro entre días de 7 | la mediana lo absorbe |
| registros de dos tallas | se agregan juntos (D-12) |
| consumo reciente al alza | la predicción reacciona |
| cambio de talla en 8 d, confianza `MEDIUM`+, agotamiento en 12 | `HOLD_SIZE_CHANGE` |
| cambio de talla en 8 d, confianza `LOW` (media poblacional) | avisa, **no** bloquea |
| cambio de talla en 3 d, agotamiento en 5 | `BUY_BOTH_SIZES` |
| 98 necesarios, paquetes de 30 | 4 paquetes |
| 1 día de datos | confianza `LOW` |
| 20 días, consumo estable | confianza `HIGH` |
| 20 días, consumo errático | confianza `MEDIUM` |

**`transition.ts`** (§8) — combinados por el mínimo, sin mocks:

| Caso | Esperado |
|---|---|
| Sin pesos, sin señales, sin `typicalMonths` | `null` |
| Sin pesos, 3 semanas en talla 1 (típica 1,7 m) | ~29 días, `LOW` |
| Bebé de 10 días | peso `null`; puede haber estimación por tiempo |
| Sin `birthDate` | estimador de peso `null` |
| 1 peso, 4 kg, talla 1, objetivo 4,5 | ~20 días, `LOW` |
| Peso de 4 kg registrado hoy, talla 1, objetivo 4,5, sexo masculino | **19 días** exactos — 183,75 g/sem (175 × 1,05), aplicado una sola vez; neutro daría 20, doble aplicación 18 |
| Mismo caso, sexo femenino | **21 días** exactos — 166,25 g/sem (175 × 0,95) |
| 2 pesos, ganancia real 250 g/sem | usa 250, no la tabla; `MEDIUM` |
| 2 pesos, ganancia negativa | ignora, usa tabla; `LOW` |
| 2 pesos separados 3 días | intervalo corto → usa tabla |
| Peso ya sobre el objetivo | 0 días |
| Talla sin rangos configurados | peso → `null` |
| 1 señal | 3 días, `MEDIUM` |
| 2 señales | 0 días, `HIGH` |
| Señales (3 d) y peso (30 d) | **3 días** — gana el mínimo |
| Empate en días entre dos estimadores | gana la confianza más alta, sea cual sea el orden |
| `LOW` + stock alto | avisa, **no** bloquea |
| `MEDIUM` + stock alto | bloquea → `HOLD_SIZE_CHANGE` |
| `MEDIUM` + quedan 5 días | **no bloquea** (D-15) |
| Prematuro de 34 sem, 8 sem de vida | edad corregida = 2 sem |
| A término (40 sem) | edad corregida = cronológica |
| Rango con 1,2 kg pendientes a 175 g/sem | min ≈ 37 d, max ≈ 67 d |
| Edad a través de un cambio de hora | días naturales entre fechas lógicas, no milisegundos |

### Sincronización — con `FakeSyncBackend`

- Dos dispositivos registran offline → sincronizan → mismo stock en ambos
- Reenviar el mismo movimiento dos veces → no duplica
- Respuesta a medias → nada se marca → el reintento lo recupera
- Paginación de 600 filas → se bajan todas, sin saltos
- **Un `UNDO` que llega antes que su movimiento original → el stock acaba correcto**

> El último test valida la premisa entera del ledger: **el orden de llegada no importa.** Si
> pasa, la sincronización es correcta.

### Migración de Dexie (src/db) — sobre base con datos, no vacía (§4.4)

- Base v1 con movimientos, pesos y una talla con el rango editado a mano → tras migrar existe
  la talla 7, los campos ausentes de las 0-6 quedan rellenos desde `DODOT_SIZES` y **el rango
  editado se conserva intacto**
- Base v1 con la siembra original intacta (0-6 sin datos) → las 8 tallas quedan idénticas a
  `DODOT_SIZES`
- Base nueva → siembra directa de 0-7, sin pasar por `upgrade()`
- Los movimientos no cambian: mismo `count`, mismos deltas (D-02)

### End-to-end

- Onboarding → Home → registrar → stock baja → cerrar → reabrir → persiste
- Modo avión completo (§11)

---

## 16. Orden de implementación

| Fase | Contenido | Salida |
|---|---|---|
| 1 | Proyecto, PWA, Dexie, `/shared`, onboarding, Home, registro, export | **Prueba del modo avión** |
| 2 | Inventario, registro múltiple, compras, ajustes, cambio de talla, historial | App usable en un móvil |
| 3 | Worker, D1, sync completo | Dos móviles convergen |
| 4 | Motor de forecast + integración en UI | Predicciones |
| 5 | Web Push, anti-spam, accesibilidad, pulido | Completo |
| 6 | Uso real, sin funcionalidades nuevas *(restricción levantada 2026-08-29, ver abajo)* | Colchón |

**Actualización (2026-08-29): se levanta la restricción de "sin funcionalidades nuevas" en la
fase 6.** La prioridad sigue siendo el uso real y que el contador compartido funcione perfecto;
las funcionalidades aprobadas (issues #12–#15) pueden hacerse antes del parto siempre que no
comprometan el sync ni el registro offline. La línea de corte de abajo se mantiene intacta.

**El sync va en la fase 3, no al final.** Es la parte con más riesgo y debe quedar margen de
maniobra.

**Línea de corte:** si al llegar a la fase 6 el sync no es sólido, se abandona el forecast y se
dedica el resto a que el contador compartido funcione perfecto. Un contador fiable es útil; un
forecast bonito sobre datos que no cuadran, no.

---

## 17. Limitaciones conocidas

Decisiones conscientes, no defectos. Documentadas para que nadie las "arregle" por su cuenta ni
las descubra por sorpresa.

| Limitación | Consecuencia | Por qué se acepta |
|---|---|---|
| Las tallas no se sincronizan | Editar un rango de peso o una media de talla en un móvil no llega al otro | Datos casi estáticos, sembrados igual en ambos con `DODOT_SIZES`. Sincronizarlos añadiría conflictos por un caso marginal |
| Las señales de transición no se sincronizan | Cada padre ve las suyas | Viven en `localStorage`. Sincronizarlas exigiría un tipo de evento nuevo |
| El snooze de "Todavía no" (§8.7) no se sincroniza | Cada padre ve el aviso de transición por separado y lo silencia solo en su móvil | Vive en `localStorage`, como las señales. Sincronizarlo exigiría un evento nuevo; el coste es bajo — un aviso de más, nunca una compra de más |
| El secreto es público | Ver §9.8 | Sin datos sensibles |
| Desfase de reloj entre móviles | Ver §9.9 | Ambos con hora automática de red |
| Sin resolución de conflictos para `Baby` | Editar el nombre a la vez en ambos: gana el último | Last-write-wins sobre `updated_at`. Se edita casi nunca |
| El forecast semillado usa medias de fabricante | Los primeros días el consumo es una cifra de la tabla Dodot, etiquetada *"estimación del fabricante"*, con confianza `LOW` y sin poder bloquear compras | No es inventar una cifra (D-13): es una media publicada y etiquetada como tal. Callarse, justo los días tras el parto, sería peor |

## 18. Fuera de alcance

Login · cuentas de usuario · sincronización multi-hogar · iOS · comparación de precios · compra
integrada · escáner de códigos de barras · IA · reconocimiento de imágenes · integración con
tiendas · curvas pediátricas · recomendaciones médicas.

> La *extrapolación de talla por peso* estaba aquí y sale de la lista: la rescata D-24 (§8).
