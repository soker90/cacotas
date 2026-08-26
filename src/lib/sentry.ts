import * as Sentry from '@sentry/browser'
import { getDeviceId } from '../sync/device-id.ts'

/**
 * Sentry (SPEC.md §13): client errors from both phones. DSN comes from the
 * build environment — without it Sentry is simply not initialized.
 * Events are tagged with deviceId and NEVER carry baby data.
 */
export const initSentry = (): void => {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (typeof dsn !== 'string' || dsn === '') return

  void Sentry.init({
    dsn,
    // Baby data never travels: no breadcrumbs, no request bodies
    sendDefaultPii: false,
    beforeBreadcrumb: () => null,
  })
  Sentry.setTag('deviceId', getDeviceId())
}
