// Push handlers appended to the generated service worker via workbox
// importScripts (vite.config.ts). Kept separate from app code because this
// file runs inside the SW scope with no access to the bundle.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Cacotas'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: data.data || {},
      actions: [{ action: 'snooze', title: 'Me encargo yo' }],
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'snooze') {
    // "Me encargo yo": silence this kind+size for 24 h (SPEC.md §12)
    const info = event.notification.data || {}
    const snoozedUntil = Date.now() + 24 * 60 * 60 * 1000
    event.waitUntil(
      fetch('/api/snooze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          babyId: info.babyId,
          sizeId: info.sizeId,
          kind: info.kind,
          snoozedUntil
        })
      }).catch(() => {})
    )
    return
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow('/')
    })
  )
})
