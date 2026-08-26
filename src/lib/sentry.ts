import * as Sentry from '@sentry/browser'
import { getDeviceId } from '../sync/device-id.ts'

/**
 * Sentry (SPEC.md §13): client errors from both phones. DSN comes from the
 * build environment — without it Sentry is simply not initialized.
 * Events are tagged with deviceId and NEVER carry baby data.
 *
 * Known limitation: ad/tracker blockers (uBlock, Privacy Badger, etc.)
 * commonly block *.sentry.io by default list — verified errors simply never
 * leave the browser for those users. Nothing to fix client-side; accepted.
 */
export const initSentry = (): void => {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (typeof dsn !== 'string' || dsn === '') return

  void Sentry.init({
    dsn,
    // Baby data never travels: no breadcrumbs, no request bodies, no user
    // context. Defense-in-depth even though no code path interpolates baby
    // fields (name/dates/weight) into error messages today.
    sendDefaultPii: false,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => {
      delete event.user
      delete event.request
      return event
    },
  })
  Sentry.setTag('deviceId', getDeviceId())
}
