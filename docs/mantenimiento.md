# Mantenimiento y operación

## Qué hay que mantener

Una instalación de Cacotas tiene cuatro piezas independientes:

1. Código del frontend.
2. Worker.
3. Base D1.
4. Integraciones externas: Google, Netlify y Web Push/VAPID.

## Actualizaciones de dependencias

Las versiones están fijadas exactamente en `package.json`.

Al actualizar dependencias:

1. Cambia la versión explícitamente.
2. Ejecuta `pnpm install`.
3. Commitea `pnpm-lock.yaml`.
4. Ejecuta toda la validación.
5. Comprueba especialmente Vite, React, Workbox, Dexie, Wrangler y TypeScript.

No introduzcas `^` o `~` en las dependencias.

## Migraciones D1

Una migración nueva debe ser:

- incremental;
- reproducible;
- compatible con los datos existentes;
- aplicada automáticamente por CI.

No edites migraciones antiguas después de que hayan llegado a producción.

Para inspeccionar las migraciones remotas:

```bash
pnpm exec wrangler d1 migrations list DB --remote --config worker/wrangler.jsonc
```

## Diagnóstico de sincronización

Si dos dispositivos no muestran los mismos datos:

1. Comprueba que ambos usan el mismo `VITE_SYNC_URL`.
2. Comprueba que han iniciado sesión con la cuenta correcta.
3. Comprueba que pertenecen al mismo hogar.
4. Comprueba que el Worker responde.
5. Comprueba los datos locales de IndexedDB.
6. Comprueba que el movimiento tiene UUID y secuencia de servidor.
7. Revisa los logs del Worker.

No borres la base D1 para solucionar un problema de sincronización sin identificar primero la causa.

## Diagnóstico de D1

Comprueba primero el estado de migraciones.

Después revisa:

- `households`;
- `users`;
- `sessions`;
- `babies`;
- `movements`;
- `weights`;
- `locations`.

Los movimientos son el historial fuente. No deben eliminarse para «limpiar» un stock.

## Sesiones

Las sesiones son tokens opacos para el cliente y hashes en D1.

Una sesión expira si lleva más de 90 días sin actividad.

Si un usuario pierde la sesión, volver a iniciar sesión con Google genera una nueva sesión para ese dispositivo.

## Invitaciones

Las invitaciones pertenecen a un hogar y tienen caducidad.

Si una invitación se comporta de forma inesperada, comprueba:

- código;
- hogar;
- fecha de expiración;
- si ya fue aceptada;
- si fue rechazada;
- intentos recientes desde la IP.

## Notificaciones

Si una notificación no llega:

1. Comprueba que el navegador soporta Web Push.
2. Comprueba el permiso de notificaciones.
3. Comprueba la suscripción local del Service Worker.
4. Comprueba la fila correspondiente en `push_subscriptions`.
5. Comprueba las claves VAPID del Worker.
6. Comprueba `notification_log`.
7. Comprueba los logs de ejecución programada.

El Worker ejecuta el cron cada hora, pero el proceso de notificaciones está restringido a la hora de Madrid prevista por la aplicación.

## Cron

La configuración contiene:

```json
"triggers": {
  "crons": ["0 * * * *"]
}
```

No cambies el cron sin revisar antes `worker/index.ts` y `worker/notify.ts`.

## Recuperación

Antes de operaciones destructivas:

- exporta los datos cuando sea posible;
- conserva una copia del esquema;
- identifica la versión de aplicación desplegada;
- identifica las migraciones D1 aplicadas;
- documenta cualquier intervención manual.

La aplicación incluye exportación JSON como red de seguridad funcional.

## Seguridad

Nunca publiques:

- tokens de Cloudflare;
- tokens de Netlify;
- claves privadas VAPID;
- archivos `.env`;
- `worker/.dev.vars`;
- credenciales de acceso.

Si un secreto se filtra:

1. Revócalo o rótalo inmediatamente.
2. Sustitúyelo en el servicio correspondiente.
3. Revisa los logs.
4. No intentes «arreglarlo» únicamente borrando el commit del historial.

## Cambiar de dominio

Si pasas de `cacotas.netlify.app` a otro dominio:

1. Cambia `APP_URL` en `worker/wrangler.jsonc`.
2. Actualiza `VITE_SYNC_URL` si también cambia el Worker.
3. Añade el nuevo origen a Google.
4. Configura el nuevo sitio Netlify.
5. Comprueba CORS.
6. Comprueba la instalación PWA.
7. Comprueba Web Push.
8. Despliega y prueba login, hogar y sincronización antes de retirar el dominio antiguo.
