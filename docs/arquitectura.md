# Arquitectura

Cacotas es una PWA offline-first. El navegador es el lugar donde vive la experiencia principal; el backend existe principalmente para sincronizar dos dispositivos y mantener la identidad/hogar.

## Componentes

### Frontend

- React 19.
- TypeScript.
- Vite.
- React Router.
- `vite-plugin-pwa`.
- Dexie sobre IndexedDB.
- `dexie-react-hooks` para reaccionar a cambios locales.
- Sentry opcional.
- Web Push en navegadores compatibles.

### Lógica compartida

`shared/` contiene TypeScript puro que se utiliza desde cliente y Worker.

Principales módulos:

| Archivo | Responsabilidad |
|---|---|
| `types.ts` | Tipos de dominio compartidos |
| `factory.ts` | Único punto válido para crear movimientos |
| `forecast.ts` | Consumo y previsiones |
| `transition.ts` | Estimación del cambio de talla |
| `needs.ts` | Necesidades de compra |
| `purchase-timing.ts` | Momento recomendado de compra |
| `notifications.ts` | Reglas comunes de notificaciones |
| `time.ts` | Tratamiento de fechas y zona horaria |

Esta carpeta no debe importar React, Dexie, APIs de Cloudflare ni APIs del navegador.

## Cliente

```text
src/
├── auth/          Login Google y sesión local
├── components/    Componentes reutilizables
├── db/            Dexie, persistencia y datos derivados
├── hooks/         Hooks de React
├── layout/        Estructura de navegación
├── lib/            Utilidades y servicios
├── pages/         Pantallas principales
├── pwa/           Service Worker y actualización
└── sync/          Backend HTTP, motor y scheduler de sincronización
```

`src/db` es la frontera con IndexedDB. La lógica pura que puede compartirse debe permanecer en `shared/`.

## Persistencia local

La base IndexedDB se llama `cacotas`.

El cliente almacena, entre otros:

- bebés;
- movimientos;
- pesos;
- tallas;
- ubicaciones.

La aplicación puede seguir registrando operaciones sin red.

## Ledger de movimientos

Los movimientos son append-only.

No se corrige un movimiento existente con `UPDATE` o `DELETE`. Para deshacer una operación se registra otro movimiento que invierte su efecto.

Esto es una decisión estructural para que dos dispositivos puedan converger sin resolver conflictos de valores mutables.

### Regla crítica

Todos los movimientos deben crearse mediante `shared/factory.ts`.

No crees movimientos directamente desde:

- componentes React;
- el Worker;
- scripts;
- tests.

La factory mantiene coherentes `quantity` y `delta`.

## Sincronización

El cliente tiene un motor de sincronización en `src/sync/`.

El Worker proporciona, entre otros, estos endpoints:

- `POST /auth/google`
- `POST /sync`
- `GET /household/status`
- `POST /household/create`
- `POST /household/invite`
- `POST /household/invite/accept`
- `POST /household/invite/reject`
- `POST /household/leave`
- `POST /account/delete`
- `POST /movement`
- `POST /push-subscribe`
- `POST /snooze`

El cursor de sincronización procede de la secuencia asignada por el servidor. No debe sustituirse por timestamps.

El servidor utiliza UUID de cliente para hacer las operaciones idempotentes.

## Arranque en un segundo dispositivo

Un segundo dispositivo no debe mostrar un onboarding vacío y crear un bebé duplicado antes de comprobar el servidor.

El flujo es:

1. Login.
2. Comprobación del hogar.
3. Resolución de startup.
4. Descarga de bebé, movimientos, pesos, ubicaciones y configuración.
5. Escritura en IndexedDB.
6. Entrada en la aplicación.

Esta secuencia es especialmente importante para mantener la convergencia entre dispositivos.

## Hogares

El modelo actual admite un hogar con hasta dos usuarios.

La cuenta se identifica mediante Google y el Worker mantiene una sesión opaca asociada al usuario y dispositivo.

El hogar agrupa:

- bebé;
- movimientos;
- pesos;
- ubicaciones;
- configuración;
- suscripciones push.

## Ubicaciones

Una ubicación representa un lugar físico de stock, por ejemplo «Casa» o «Abuelos».

El stock depende de la ubicación activa, mientras que el consumo y la previsión se calculan globalmente para el bebé.

Las ubicaciones se sincronizan porque forman parte del inventario compartido.

## Previsión

La previsión no pretende conocer una cifra exacta del futuro.

El sistema utiliza el historial disponible y, cuando falta información, mantiene explícitamente la incertidumbre.

La transición de talla combina varias señales y presenta un rango. Entre ellas se incluyen:

- señales observadas de que una talla queda pequeña;
- proyección de peso;
- duración típica de la talla.

Las reglas detalladas están en `shared/transition.ts` y en `SPEC.md`.

## PWA

La configuración de PWA está en `vite.config.ts`.

Características relevantes:

- modo `standalone`;
- `start_url=/`;
- `scope=/`;
- accesos directos a registrar pañal e inventario;
- Service Worker generado por Workbox;
- actualización controlada mediante `UpdatePrompt`;
- soporte para Web Push.

La versión visible de la aplicación se inyecta desde `package.json` como `__APP_VERSION__`.

## Notificaciones

El Worker ejecuta un cron cada hora. La lógica de notificaciones comprueba la hora local de Madrid y ejecuta el proceso correspondiente a las 20:00.

Las suscripciones se almacenan en D1 y las notificaciones se envían con VAPID.

## Base de datos del Worker

D1 contiene tablas para:

- hogares;
- usuarios;
- invitaciones;
- sesiones;
- bebés;
- secuencias;
- movimientos;
- pesos;
- ubicaciones;
- suscripciones push;
- registro de notificaciones;
- configuración del hogar.

Las migraciones versionadas están en `worker/migrations/`.

## Fronteras que no deben romperse

Hay cuatro reglas especialmente importantes:

1. `shared/` permanece independiente del entorno.
2. Los movimientos se crean exclusivamente mediante la factory.
3. El ledger es append-only.
4. Las migraciones de D1 son acumulativas y no se reescriben una vez desplegadas.
