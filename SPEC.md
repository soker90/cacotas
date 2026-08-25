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
  sizeId: number;                 // 0..6

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
  birthDate?: string;             // 'YYYY-MM-DD'
  zoneId: string;                 // 'Europe/Madrid'
  createdAt: number;
  updatedAt: number;              // last-write-wins al sincronizar
  serverSeq?: number;
}

export interface WeightRecord {
  id: UUID;
  babyId: UUID;
  weightKg: number;
  recordedAt: number;
  deviceId: string;
  serverSeq?: number;
}

export interface DiaperSize {
  id: number;                     // 0..6 = número de talla
  name: string;                   // 'Talla 2'
  minWeightKg?: number;
  maxWeightKg?: number;
}

/** Señales manuales de que la talla se queda pequeña. */
export interface TransitionSignals {
  leaks: boolean;                 // escapes frecuentes
  tight: boolean;                 // queda ajustado
  marks: boolean;                 // deja marcas
  hardToClose: boolean;           // cuesta cerrarlo
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
Siempre:          quantity >= 0, sizeId ∈ [0,6], occurredAt <= recordedAt + 60s

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
Al crearla, sembrar las tallas 0-6 con `name: 'Talla N'` y rangos de peso vacíos.

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
  recorded_at INTEGER NOT NULL,
  device_id  TEXT NOT NULL
);

CREATE TABLE babies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  birth_date TEXT,
  zone_id    TEXT NOT NULL,
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
  now: number;
  transitionDays: number | null;    // ver §8
  warningDays: number;              // 7
  coverageDays: number;             // 21
  diapersPerPackage?: number;
}

export type Confidence = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

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
  status: ForecastStatus;
  recommendedDiapers: number | null;
  recommendedPackages: number | null;
}
```

La UI renderiza el texto a partir de `status`. **El motor no devuelve cadenas de texto.**

### 7.2 Cálculo del consumo diario

```ts
export function dailyConsumption(usage: Movement[], now: number) {
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
  if (days.length === 0) return null;

  const counts = days.map(([, n]) => n);
  const last7  = counts.slice(-7);
  const last3  = counts.slice(-3);

  // 5. Estimador: mediana, robusta a días parcialmente registrados (D-22)
  let value: number;
  if (days.length >= 7)      value = 0.4 * median(last3) + 0.6 * median(last7);
  else if (days.length >= 3) value = median(counts);
  else                       value = mean(counts);

  // 6. Cobertura: cuántos de los días naturales del periodo tienen registro
  const span = daysBetween(days[0][0], days.at(-1)![0]) + 1;
  const coverage = days.length / span;

  // 7. Variabilidad
  const variabilityHigh = counts.length >= 3 &&
    stdev(last7) / median(last7) > 0.4;

  return { value, daysCovered: days.length, coverage, variabilityHigh };
}
```

> **Nota de diseño.** La versión anterior de la especificación proponía un EWMA con half-life de
> 5 días. Se descarta: al eliminar los días sin registro, la serie queda irregularmente
> espaciada y el EWMA se vuelve ambiguo (¿decae por hueco natural o por índice?). La mezcla de
> medianas `0.4·mediana(3) + 0.6·mediana(7)` reacciona igual a la tendencia, es robusta a
> valores atípicos, y no admite dos interpretaciones distintas.

### 7.3 Confianza

```
daysCovered = 0            → NONE
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
  transitionDays !== null && transitionDays < daysRemaining;

// D-15: el bloqueo NUNCA aplica cuando ya queda poco margen
if (lowStock && transitionFirst)       return 'BUY_BOTH_SIZES';
if (lowStock)                          return 'BUY_NOW';
if (transitionFirst)                   return 'HOLD_SIZE_CHANGE';
return 'OK';
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

Mostrar siempre *"aproximadamente 12 días"*, **nunca** `11,99923`.

---

## 8. Transición de talla (`shared/transition.ts`)

El usuario cambia de talla a mano (D-06). Esto solo produce el **horizonte estimado** que
alimenta `transitionDays`.

### Fuente: señales manuales

En el detalle de talla, cuatro casillas que el usuario marca cuando lo observa:

```
☐ Escapes frecuentes
☐ Le queda ajustado
☐ Le deja marcas
☐ Cuesta cerrarlo
```

```ts
export function transitionDays(signals: TransitionSignals): number | null {
  const n = Object.values(signals).filter(Boolean).length;
  if (n === 0) return null;    // sin señales, sin predicción y sin bloqueo
  if (n === 1) return 21;      // APPROACHING
  return 7;                    // LIKELY_SOON (2 o más señales)
}
```

**Se descarta la extrapolación por peso** para el MVP: los rangos de los fabricantes se solapan
mucho (talla 2: 3-6 kg, talla 3: 4-9 kg), exige pesar al bebé con regularidad, y las señales
observadas son mejores predictores.

`WeightRecord` se mantiene en el modelo para el futuro, pero **no se usa en el MVP**.

Las señales se guardan por `(babyId, sizeId)` en `localStorage` y se limpian al cambiar de
talla. No se sincronizan.

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

Fecha de nacimiento y peso **no se piden aquí**: se piden después, en contexto. Es una pantalla
que se usa una sola vez y cada paso extra es fricción antes de ver valor.

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

Stock, consumo diario, últimos 7/14 días, estimación, fecha de agotamiento, confianza.
Casillas de señales de transición (§8).
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
| `SIZE_CHANGE_APPROACHING` | `transitionDays !== null` | Solo en la app |
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

### Dashboard

Misma base de código, misma D1. Consumo diario en el tiempo, media móvil de 7 días (muestra la
curva descendente del primer año, D-21), **duración real de cada talla** derivada de los
`SIZE_CHANGE` — el dato con más valor a largo plazo.

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

**`forecast.ts`**

| Caso | Esperado |
|---|---|
| stock 70, consumo 7/día | 10 días |
| stock 0 | 0 días |
| sin historial | `NO_DATA` |
| solo pañales `EXTERNAL` | `NO_DATA` |
| días sin registro intercalados | no hunden la media |
| un día con 1 registro entre días de 7 | la mediana lo absorbe |
| registros de dos tallas | se agregan juntos (D-12) |
| consumo reciente al alza | la predicción reacciona |
| cambio de talla en 8 d, agotamiento en 12 | `HOLD_SIZE_CHANGE` |
| cambio de talla en 3 d, agotamiento en 5 | `BUY_BOTH_SIZES` |
| 98 necesarios, paquetes de 30 | 4 paquetes |
| 1 día de datos | confianza `LOW` |
| 20 días, consumo estable | confianza `HIGH` |
| 20 días, consumo errático | confianza `MEDIUM` |

### Sincronización — con `FakeSyncBackend`

- Dos dispositivos registran offline → sincronizan → mismo stock en ambos
- Reenviar el mismo movimiento dos veces → no duplica
- Respuesta a medias → nada se marca → el reintento lo recupera
- Paginación de 600 filas → se bajan todas, sin saltos
- **Un `UNDO` que llega antes que su movimiento original → el stock acaba correcto**

> El último test valida la premisa entera del ledger: **el orden de llegada no importa.** Si
> pasa, la sincronización es correcta.

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
| 6 | Uso real, sin funcionalidades nuevas | Colchón |

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
| Las tallas no se sincronizan | Editar un rango de peso en un móvil no llega al otro | Datos casi estáticos, sembrados igual en ambos. Sincronizarlos añadiría conflictos por un caso marginal |
| Las señales de transición no se sincronizan | Cada padre ve las suyas | Viven en `localStorage`. Sincronizarlas exigiría un tipo de evento nuevo |
| El secreto es público | Ver §9.8 | Sin datos sensibles |
| Desfase de reloj entre móviles | Ver §9.9 | Ambos con hora automática de red |
| Sin resolución de conflictos para `Baby` | Editar el nombre a la vez en ambos: gana el último | Last-write-wins sobre `updated_at`. Se edita casi nunca |
| El forecast no dice nada las 2 primeras semanas | Sin predicción justo al llegar del hospital | Es lo honesto: no hay datos. Mostrar una cifra inventada sería peor (D-21) |

## 18. Fuera de alcance

Login · cuentas de usuario · sincronización multi-hogar · iOS · comparación de precios · compra
integrada · escáner de códigos de barras · IA · reconocimiento de imágenes · integración con
tiendas · curvas pediátricas · recomendaciones médicas · extrapolación de talla por peso.
