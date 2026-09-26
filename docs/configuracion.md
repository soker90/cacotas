# Configuración

Cacotas tiene dos grupos de configuración: variables del frontend y variables del Worker.

## Frontend

El frontend utiliza variables `VITE_*`. Vite las incorpora al bundle durante la compilación, por lo que **no deben considerarse secretos**.

| Variable | Obligatoria | Uso |
|---|---|---|
| `VITE_SYNC_URL` | Sí para backend | URL base del Worker, por ejemplo `https://cacotas-sync.example.workers.dev` |
| `VITE_GOOGLE_CLIENT_ID` | Sí para login | Client ID de Google Identity Services |
| `VITE_VAPID_PUBLIC_KEY` | Sí para push | Clave pública VAPID usada por el navegador |
| `VITE_SENTRY_DSN` | No | DSN de Sentry para errores del frontend |

`VITE_SYNC_SECRET` aparece en archivos históricos/tipos del proyecto, pero el flujo actual de autenticación utiliza sesiones opacas emitidas por el Worker. No lo configures salvo que el código actual vuelva a utilizarlo.

### `.env.example`

El archivo raíz `.env.example` es la plantilla que debe copiarse a `.env`. Nunca subas `.env` al repositorio.

## Worker

El Worker se llama `cacotas-sync` y su configuración está en `worker/wrangler.jsonc`.

### Variables públicas del Worker

`APP_URL` está definida en `worker/wrangler.jsonc` porque no es secreta. Debe coincidir exactamente con el origen desde el que se sirve la aplicación, por ejemplo:

```text
https://cacotas.netlify.app
```

Si se cambia el dominio, hay que actualizar esta variable y también el origen autorizado en Google.

### Secretos del Worker

El Worker necesita:

| Variable | Uso |
|---|---|
| `GOOGLE_CLIENT_ID` | Verifica los ID tokens de Google |
| `VAPID_PRIVATE_KEY` | Firma las notificaciones Web Push |
| `VAPID_PUBLIC_KEY` | Clave pública correspondiente a la privada |
| `VAPID_SUBJECT` | Identidad/contacto del emisor VAPID, normalmente una URL `mailto:` |

En producción se deben almacenar como secretos de Cloudflare, no en `wrangler.jsonc`.

Ejemplo:

```bash
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --config worker/wrangler.jsonc
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.jsonc
pnpm exec wrangler secret put VAPID_PUBLIC_KEY --config worker/wrangler.jsonc
pnpm exec wrangler secret put VAPID_SUBJECT --config worker/wrangler.jsonc
```

Wrangler solicitará el valor de cada secreto de forma interactiva.

Para desarrollo local:

```bash
cp worker/.dev.vars.example worker/.dev.vars
```

No copies secretos reales a archivos que vayan a Git.

## Google Identity Services

Cacotas utiliza Google Identity Services en el navegador y verifica el ID token en el Worker.

En Google Cloud:

1. Crea o selecciona un proyecto.
2. Configura la pantalla de consentimiento según corresponda.
3. Crea un cliente OAuth de tipo aplicación web.
4. Añade como origen JavaScript autorizado el origen de Cacotas.
5. Para desarrollo, añade también el origen local que utilices.
6. Guarda el Client ID en `VITE_GOOGLE_CLIENT_ID`.
7. Usa el mismo Client ID como `GOOGLE_CLIENT_ID` en el Worker.

No introduzcas el Client ID como un secreto del frontend: forma parte del bundle. La validación importante se realiza en el Worker.

## Web Push / VAPID

El navegador necesita la clave pública VAPID y el Worker necesita la pareja completa.

Una vez generadas las claves:

- `VITE_VAPID_PUBLIC_KEY` = clave pública.
- `VAPID_PUBLIC_KEY` = la misma clave pública en el Worker.
- `VAPID_PRIVATE_KEY` = clave privada.
- `VAPID_SUBJECT` = contacto del propietario de la aplicación.

La clave privada nunca debe aparecer en el frontend, GitHub ni `wrangler.jsonc`.

## Sentry

Sentry es opcional. Si `VITE_SENTRY_DSN` está vacío, el inicializador de Sentry no activa el envío de errores.

## D1

La configuración actual referencia:

- Worker: `cacotas-sync`
- Binding: `DB`
- Base de datos: `cacotas-db`
- Migraciones: `worker/migrations/`

Para una instalación completamente independiente, crea tu propia base D1 y cambia el `database_id` de `worker/wrangler.jsonc`.

No reutilices la base de datos de otra instalación.

## Configuración de CI/CD

El workflow `.github/workflows/ci.yml` utiliza estos secretos de GitHub:

### Frontend

- `VITE_SYNC_URL`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_VAPID_PUBLIC_KEY`
- `VITE_SENTRY_DSN` (puede ser vacío si no se usa Sentry)

### Netlify

- `NETLIFY_SITE_ID`
- `NETLIFY_AUTH_TOKEN`

### Cloudflare

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Los secretos de ejecución del Worker (Google/VAPID) viven en Cloudflare y no necesitan exponerse como secretos de GitHub: el workflow despliega el código sobre el Worker ya configurado.

## Regla de seguridad

Nunca hagas commit de:

- `.env`
- `worker/.dev.vars`
- claves privadas VAPID
- tokens de Cloudflare
- tokens de Netlify
- credenciales de Google que permitan actuar como una cuenta
