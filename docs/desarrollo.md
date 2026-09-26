# Desarrollo y contribución

## Comandos

Desde la raíz:

| Comando | Uso |
|---|---|
| `pnpm dev` | Servidor Vite de desarrollo |
| `pnpm build` | Typecheck + build de producción |
| `pnpm preview` | Sirve localmente el build |
| `pnpm test` | Ejecuta todos los tests una vez |
| `pnpm test:watch` | Tests en modo watch |
| `pnpm lint` | Ejecuta ESLint |
| `pnpm lint:fix` | Corrige automáticamente lo que ESLint pueda corregir |
| `pnpm typecheck` | Typecheck del frontend |
| `pnpm typecheck:worker` | Typecheck del Worker |

## Definition of Done

Antes de subir una modificación:

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:worker
pnpm test
pnpm build
```

No consideres una tarea terminada si cualquiera de estos comandos falla.

El CI de GitHub ejecuta exactamente estas comprobaciones antes del despliegue.

## Estilo

El proyecto usa Standard JS mediante `neostandard`:

- sin punto y coma;
- comillas simples;
- dos espacios;
- arrow functions cuando sea natural;
- sin `any`;
- versiones exactas en `package.json`.

Los identificadores, comentarios y código están en inglés. Los textos visibles de la interfaz están en español.

## Cambios de dominio

Si cambias la lógica de previsión, transición, necesidades o movimientos:

1. Modifica la implementación de `shared/`.
2. Añade o actualiza tests en `tests/`.
3. Comprueba que no introduces dependencias del navegador o React en `shared/`.
4. Ejecuta la suite completa.

## Movimientos

Nunca hagas:

```ts
await db.movements.update(...)
await db.movements.delete(...)
```

El ledger es append-only.

Para corregir un movimiento se registra un movimiento inverso mediante la factory.

## Cambios de esquema

Los cambios del esquema local de Dexie deben tener una migración de versión.

Los cambios de D1 deben tener una nueva migración SQL en `worker/migrations/`.

No edites una migración que ya se haya aplicado en producción.

## Tests

Los tests cubren, entre otras áreas:

- base de datos;
- factory;
- forecast;
- transición de talla;
- necesidades;
- tiempos de compra;
- notificaciones;
- ubicaciones;
- persistencia del inventario;
- sincronización;
- backend HTTP;
- resolución del arranque;
- estadísticas.

La lógica de `shared/` debe poder probarse sin mocks del navegador.

## Commits

Mantén los commits pequeños y relacionados con una única tarea.

Formato recomendado:

```text
fix(inventory): ...
feat(sync): ...
docs(setup): ...
test(forecast): ...
```

## Versionado

La versión vive en `package.json`.

**Cada commit que llegue a `master` debe incrementar la versión**, como mínimo con una subida de tipo fix. Una corrección compatible normalmente incrementa el último componente; una nueva funcionalidad compatible incrementa el componente minor.

Ejemplos:

- `0.20.7 → 0.20.8`: corrección.
- `0.20.8 → 0.21.0`: nueva funcionalidad.
- `0.21.0 → 0.21.1`: siguiente corrección.

La versión se inyecta automáticamente en Vite y se muestra en Ajustes.

## Pull Requests

Antes de solicitar revisión:

1. Revisa el diff completo.
2. Ejecuta lint.
3. Ejecuta ambos typechecks.
4. Ejecuta tests.
5. Ejecuta build.
6. Comprueba que la versión se ha incrementado.
7. Si cambiaste `worker/` o `shared/`, revisa también las migraciones y el impacto sobre el Worker.

No mezcles cambios no relacionados en una misma PR.

## CI

`.github/workflows/ci.yml` se ejecuta en PR y en `master`.

En `master`, después de pasar las comprobaciones:

- publica el frontend en Netlify;
- detecta cambios en `worker/` o `shared/`;
- aplica migraciones D1 si son necesarias;
- despliega el Worker si es necesario.

## Reglas de diseño que no deben romperse

Consulta también `AGENTS.md` y `SPEC.md` antes de modificar la arquitectura.

Las reglas más importantes son:

- offline-first;
- ledger append-only;
- UUID generados en cliente;
- movimientos creados por la factory;
- `shared/` sin dependencias de entorno;
- no rellenar días sin datos con cero;
- no calcular días lógicos haciendo aritmética directa sobre epoch;
- no ofrecer onboarding local antes de resolver el estado remoto en un segundo dispositivo.
