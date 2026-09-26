# Despliegue

La instalación oficial separa el frontend estático del backend:

- **Frontend:** Netlify.
- **Backend y sincronización:** Cloudflare Workers.
- **Base de datos:** Cloudflare D1.
- **Autenticación:** Google Identity Services + sesiones almacenadas en D1.

El repositorio ya contiene el pipeline de GitHub Actions para automatizar el despliegue a producción.

## Arquitectura de despliegue

```text
                         ┌──────────────────┐
                         │    Navegador     │
                         │ React + PWA      │
                         │ Dexie / IndexedDB│
                         └────────┬─────────┘
                                  │ HTTPS
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
          ┌─────────────────┐         ┌────────────────────┐
          │     Netlify     │         │ Cloudflare Worker  │
          │   dist/         │         │   cacotas-sync     │
          └─────────────────┘         └─────────┬──────────┘
                                                │
                                                ▼
                                      ┌────────────────────┐
                                      │ Cloudflare D1       │
                                      │ cacotas-db          │
                                      └────────────────────┘
```

## 1. Crear la infraestructura de Cloudflare

Crea una base D1 propia y adapta `worker/wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "cacotas-db",
    "database_id": "<TU_DATABASE_ID>",
    "migrations_dir": "migrations"
  }
]
```

El nombre del Worker puede mantenerse como `cacotas-sync` o cambiarse por uno propio.

## 2. Aplicar las migraciones

Desde la raíz:

```bash
pnpm exec wrangler d1 migrations apply DB --remote --config worker/wrangler.jsonc
```

Comprueba el resultado antes de desplegar el Worker.

**No uses `worker/schema.sql` como sustituto de las migraciones en una base existente.** El directorio `worker/migrations/` es el mecanismo versionado de evolución de D1. `schema.sql` documenta el esquema objetivo actual.

## 3. Configurar secretos del Worker

Configura los secretos descritos en [Configuración](configuracion.md).

```bash
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --config worker/wrangler.jsonc
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.jsonc
pnpm exec wrangler secret put VAPID_PUBLIC_KEY --config worker/wrangler.jsonc
pnpm exec wrangler secret put VAPID_SUBJECT --config worker/wrangler.jsonc
```

## 4. Desplegar el Worker

```bash
pnpm exec wrangler deploy --config worker/wrangler.jsonc
```

Obtendrás una URL del estilo:

```text
https://cacotas-sync.<tu-subdominio>.workers.dev
```

Esa URL es la que debe utilizar `VITE_SYNC_URL`.

## 5. Configurar Netlify

Crea un sitio estático para el frontend.

El pipeline construye el proyecto con:

```bash
pnpm build
```

y publica el contenido de `dist/`.

Configura como variables de entorno de build:

- `VITE_SYNC_URL`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_VAPID_PUBLIC_KEY`
- `VITE_SENTRY_DSN` si se usa.

### SPA

Cacotas usa React Router. El servidor debe devolver `index.html` para las rutas de la aplicación.

Si utilizas Netlify y no quieres depender de una configuración adicional del sitio, puedes añadir un archivo `public/_redirects`:

```text
/* /index.html 200
```

Antes de añadirlo a una instalación propia, comprueba que no exista ya una regla equivalente en la configuración de tu hosting.

## 6. Configurar Google

Añade el dominio de producción como origen JavaScript autorizado del cliente OAuth.

Por ejemplo:

```text
https://cacotas.netlify.app
```

Para una instalación propia, utiliza exclusivamente tu dominio.

## 7. Configurar GitHub Actions

El workflow incluido ejecuta, en este orden:

1. Instalación con lockfile.
2. Lint.
3. Typecheck del frontend.
4. Typecheck del Worker.
5. Tests.
6. Build.
7. Deploy del frontend a Netlify en `master`.
8. Si cambió `worker/` o `shared/`, aplica migraciones D1 remotas.
9. Si cambió `worker/` o `shared/`, despliega el Worker.

Por tanto, una modificación exclusiva de React no despliega el Worker.

## 8. Orden correcto al modificar D1

Cuando una funcionalidad requiere cambiar el esquema:

1. Crea una nueva migración en `worker/migrations/`.
2. Actualiza el código del Worker.
3. Actualiza el cliente si es necesario.
4. Ejecuta los tests.
5. Comprueba `pnpm typecheck:worker`.
6. Haz push.
7. El workflow aplicará la migración antes de desplegar el Worker.

No reescribas migraciones que ya hayan llegado a producción.

## Despliegue manual de emergencia

Si GitHub Actions no está disponible:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm typecheck:worker
pnpm test
pnpm build
pnpm exec wrangler d1 migrations apply DB --remote --config worker/wrangler.jsonc
pnpm exec wrangler deploy --config worker/wrangler.jsonc
```

El frontend puede publicarse con Netlify CLI después de configurar la autenticación correspondiente.

## Verificación posterior

Después de un despliegue:

1. Abre la aplicación en una ventana privada.
2. Comprueba el login.
3. Crea o entra en un hogar.
4. Comprueba que aparece el bebé.
5. Registra un movimiento.
6. Comprueba el inventario y el historial.
7. Abre la misma cuenta en un segundo dispositivo.
8. Comprueba que el movimiento aparece después de sincronizar.
9. Si usas push, activa las notificaciones y comprueba que la suscripción se registra.

## Rollback

Antes de hacer rollback del Worker, comprueba si el código depende de una migración D1 nueva. Las migraciones de D1 no deben deshacerse de forma improvisada.

Si una migración ya está en producción, el rollback de código debe ser compatible con el esquema que queda en D1.
