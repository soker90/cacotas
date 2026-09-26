# Instalación local

Esta guía permite levantar una instancia propia de Cacotas para desarrollo o para uso personal.

## Requisitos

- Node.js 24.x.
- pnpm 11.3.0.
- Una cuenta de Google Cloud si se quiere habilitar el inicio de sesión con Google.
- Una cuenta de Cloudflare si se quiere habilitar sincronización entre dispositivos, D1 y notificaciones push.
- Una cuenta de Netlify (u otro hosting de archivos estáticos) si se quiere publicar la PWA.

El repositorio fija Node 24.x en `.nvmrc` y en `package.json`. Se recomienda ejecutar siempre los comandos con pnpm.

## 1. Clonar el repositorio

```bash
git clone https://github.com/soker90/cacotas.git
cd cacotas
```

## 2. Instalar dependencias

```bash
pnpm install --frozen-lockfile
```

## 3. Configurar el cliente

Copia el ejemplo:

```bash
cp .env.example .env
```

Rellena las variables descritas en [Configuración](configuracion.md).

Para desarrollar solamente la interfaz y la lógica local se puede trabajar sin backend. En ese caso algunas funciones, como el inicio de sesión, hogares y sincronización, no estarán disponibles.

## 4. Arrancar Vite

```bash
pnpm dev
```

Vite mostrará la dirección local, normalmente `http://localhost:5173`.

## 5. Comprobar el proyecto

Antes de considerar válida una instalación:

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:worker
pnpm test
pnpm build
```

## Desarrollo del Worker

El Worker vive en `worker/` y se ejecuta con Wrangler.

Copia las variables locales:

```bash
cp worker/.dev.vars.example worker/.dev.vars
```

Después puedes ejecutar:

```bash
pnpm exec wrangler dev --config worker/wrangler.jsonc
```

El Worker necesita acceso a D1 y a las variables de autenticación/Web Push para reproducir toda la funcionalidad. Para desarrollo local, consulta [Configuración](configuracion.md).

## Base de datos local

Las migraciones de D1 están en `worker/migrations/`. No se debe editar manualmente una base de producción para introducir cambios de esquema: crea una nueva migración SQL y deja que Wrangler la aplique.

Para ver el estado de las migraciones:

```bash
pnpm exec wrangler d1 migrations list DB --local --config worker/wrangler.jsonc
```

Para aplicarlas localmente:

```bash
pnpm exec wrangler d1 migrations apply DB --local --config worker/wrangler.jsonc
```

## Datos locales del navegador

La aplicación guarda su copia local en IndexedDB, en una base llamada `cacotas`, mediante Dexie. Borrar los datos del sitio elimina esa copia local; no equivale necesariamente a eliminar los datos sincronizados en D1.

Para probar una instalación limpia, utiliza las herramientas de almacenamiento del navegador y elimina los datos de IndexedDB del origen local.

## Primera puesta en marcha

Una instancia nueva sigue este flujo:

1. El usuario inicia sesión con Google.
2. Crea un hogar o acepta una invitación.
3. Configura los datos del bebé.
4. La aplicación crea/recupera la información local y sincroniza con el Worker.
5. Los dos dispositivos del hogar pueden converger sobre el mismo ledger de movimientos.

El hogar admite como máximo dos usuarios.

## Comprobación offline

Cacotas está diseñada como aplicación offline-first. Una prueba importante es:

1. Abrir la PWA.
2. Desactivar la red.
3. Registrar varios pañales.
4. Cerrar completamente la aplicación.
5. Volver a abrirla.
6. Comprobar que los datos siguen presentes.
7. Recuperar la red y comprobar que la sincronización termina correctamente.

## Errores frecuentes

### La aplicación muestra «Falta VITE_SYNC_URL»

La variable no está definida o está vacía. Revisa `.env` y reinicia Vite después de modificarla.

### Google no muestra el botón de inicio de sesión

Comprueba `VITE_GOOGLE_CLIENT_ID` y los orígenes JavaScript autorizados del cliente OAuth.

### El login funciona pero no aparecen los datos del hogar

Comprueba que `VITE_SYNC_URL` apunta al Worker correcto y que el Worker tiene acceso a la D1 configurada.

### Las notificaciones push no funcionan

Comprueba `VITE_VAPID_PUBLIC_KEY` en el cliente y las tres variables VAPID del Worker. Además, el navegador debe permitir notificaciones y soportar Web Push.

### Una actualización de la PWA no aparece

La PWA registra el Service Worker mediante `UpdatePrompt`. Haz una recarga normal primero y evita borrar el almacenamiento salvo que estés realizando una prueba de instalación limpia.
