# Cacotas

Cacotas es una aplicación web progresiva (PWA) para gestionar el inventario de pañales de un bebé, registrar el consumo y estimar cuándo será necesario comprar o cambiar de talla.

Está diseñada con un enfoque **offline-first**: registrar un pañal no depende de tener conexión. La red se utiliza principalmente para sincronizar los datos entre los dispositivos de un mismo hogar.

## Características

- Inventario de pañales por talla.
- Varias ubicaciones físicas de stock.
- Registro individual o múltiple de pañales.
- Historial de movimientos.
- Estadísticas de consumo.
- Previsión de consumo y necesidades de compra.
- Estimación del cambio de talla mediante señales, peso y duración típica.
- Alertas y notificaciones push.
- Funcionamiento offline mediante IndexedDB.
- Sincronización entre hasta dos usuarios del mismo hogar.
- Inicio de sesión con Google.
- PWA instalable en dispositivos compatibles.
- Exportación de datos en JSON.

## Demo

La instancia pública actual está disponible en:

https://cacotas.netlify.app/

El código fuente está en:

https://github.com/soker90/cacotas/

## Stack

| Parte | Tecnología |
|---|---|
| UI | React + TypeScript |
| Build | Vite |
| PWA | vite-plugin-pwa + Workbox |
| Persistencia local | Dexie + IndexedDB |
| Backend | Cloudflare Worker |
| Base de datos remota | Cloudflare D1 |
| Autenticación | Google Identity Services |
| Notificaciones | Web Push + VAPID |
| Observabilidad | Sentry opcional |
| Frontend en producción | Netlify |
| CI/CD | GitHub Actions |

## Primeros pasos

Necesitas Node.js 24.x y pnpm 11.3.0.

```bash
git clone https://github.com/soker90/cacotas.git
cd cacotas
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Para una instalación que incluya login, hogares y sincronización hay que configurar además el Worker de Cloudflare, D1 y Google. La guía completa está en [docs/instalacion.md](docs/instalacion.md).

## Documentación

- [Instalación local](docs/instalacion.md)
- [Configuración](docs/configuracion.md)
- [Despliegue](docs/despliegue.md)
- [Arquitectura](docs/arquitectura.md)
- [Desarrollo y contribución](docs/desarrollo.md)
- [Mantenimiento y operación](docs/mantenimiento.md)
- [Guía de contribución](CONTRIBUTING.md)
- [Especificación técnica](SPEC.md)
- [Instrucciones para agentes](AGENTS.md)

Toda la documentación nueva destinada a usuarios y colaboradores está escrita en español.

## Comandos de desarrollo

```bash
pnpm dev                 # desarrollo Vite
pnpm build               # typecheck + build
pnpm preview             # previsualizar el build
pnpm lint                # ESLint
pnpm lint:fix            # ESLint con autocorrección
pnpm typecheck           # TypeScript del frontend
pnpm typecheck:worker    # TypeScript del Worker
pnpm test                # suite completa
pnpm test:watch          # tests en modo watch
```

Antes de integrar cambios deben pasar todas las comprobaciones:

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:worker
pnpm test
pnpm build
```

## Arquitectura resumida

```text
┌──────────────────────────────┐
│ Navegador / PWA              │
│ React + Dexie + IndexedDB    │
│                              │
│ Funciona offline             │
└──────────────┬───────────────┘
               │ HTTPS
               ▼
┌──────────────────────────────┐
│ Cloudflare Worker            │
│ autenticación + sync + push  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Cloudflare D1                │
│ hogares + ledger + sesiones  │
└──────────────────────────────┘
```

La lógica de dominio que debe ser independiente del entorno está en shared/ y se comparte entre cliente y Worker.

Los movimientos forman un **ledger append-only**. No se actualizan ni se borran: una corrección se representa mediante otro movimiento inverso. Todos los movimientos deben crearse mediante shared/factory.ts.

## Sincronización

El cliente mantiene una copia local y un cursor de sincronización. El Worker asigna secuencias en D1 y proporciona endpoints para autenticación, hogares, movimientos, sincronización y notificaciones.

Un segundo dispositivo debe sincronizar los datos remotos antes de crear un bebé local, para evitar duplicados.

## Base de datos

Las migraciones remotas están en worker/migrations/.

No se deben reescribir migraciones que ya hayan sido aplicadas en producción. Los cambios de esquema se incorporan mediante una nueva migración.

## Versionado

La versión está en package.json y se inyecta automáticamente en la PWA.

**Cada commit que llegue a master debe incrementar la versión**, como mínimo con un incremento fix. Las nuevas funcionalidades compatibles pueden incrementar minor.

Ejemplos:

- 0.20.7 → 0.20.8: corrección.
- 0.20.8 → 0.21.0: nueva funcionalidad.

## Licencia

Cacotas se distribuye bajo [GNU GPL v3](LICENSE).

## Estado del proyecto

Cacotas es un proyecto en evolución. La especificación funcional y técnica de referencia está en SPEC.md; las decisiones que afectan a la implementación deben mantenerse alineadas con ella.