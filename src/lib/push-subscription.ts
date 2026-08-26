import type { UUID } from '../../shared/types.ts'

/**
 * Web Push subscription (SPEC.md §12). Requires VITE_VAPID_PUBLIC_KEY at
 * build time; the subscription is stored in D1 through the same-origin
 * proxy.
 */

const urlBase64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  // Typed as ArrayBuffer-backed for pushManager's applicationServerKey
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Padded = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64Padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export type PushSupport =
  | 'unsupported'
  | 'denied'
  | 'subscribed'
  | 'unsubscribed'

export const pushState = async (): Promise<PushSupport> => {
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return 'unsubscribed'
  const existing = await reg.pushManager.getSubscription()
  return existing !== null ? 'subscribed' : 'unsubscribed'
}

/** Idempotent upsert on the server (§4.5 push_subscriptions PK is device_id). */
const saveSubscription = async (
  babyId: UUID,
  subscription: PushSubscription
): Promise<void> => {
  const json = subscription.toJSON()
  const response = await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Auth': import.meta.env.VITE_SYNC_SECRET ?? '',
    },
    body: JSON.stringify({
      babyId,
      endpoint: subscription.endpoint,
      keys: json.keys,
    }),
  })
  if (!response.ok) throw new Error('No se pudo guardar la suscripción')
}

export const subscribeToPush = async (
  babyId: UUID,
  vapidPublicKey: string
): Promise<PushSupport> => {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return Notification.permission === 'denied' ? 'denied' : 'unsubscribed'
  }

  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return 'unsupported'

  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }))

  await saveSubscription(babyId, subscription)
  return 'subscribed'
}

/**
 * Self-heals a subscription that exists in the browser but may never have
 * reached the server (e.g. an earlier attempt failed silently). Cheap and
 * idempotent — safe to call on every Settings mount.
 */
export const resyncSubscription = async (babyId: UUID): Promise<void> => {
  const reg = await navigator.serviceWorker.getRegistration()
  const subscription = await reg?.pushManager.getSubscription()
  if (subscription) await saveSubscription(babyId, subscription)
}
