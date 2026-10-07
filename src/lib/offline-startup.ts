/**
 * When the browser is offline, the local app must not wait for any remote
 * household check. IndexedDB is still allowed to finish loading before the
 * actual home/onboarding screen is rendered.
 */
export const shouldUseCachedApp = (isOnline: boolean): boolean => !isOnline
