import { useEffect } from 'react'

/**
 * Update prompt for registerType: 'prompt' (§11), hand-rolled over the raw
 * service worker API. The plugin's workbox-window wrapper kept firing the
 * prompt spuriously (stuck needRefresh with no waiting worker).
 *
 * Flow: register /sw.js · when an updated worker reaches `installed`,
 * activate it immediately and reload when it takes control.
 */
export const UpdatePrompt = () => {
  useEffect(() => {
    let cancelled = false

    // First-ever visit: nothing controls the page yet, the first install
    // must stay silent (no "update" prompt for content never seen).
    const hasController = (): boolean =>
      !!navigator.serviceWorker.controller

    const detect = async (): Promise<void> => {
      const reg = await navigator.serviceWorker.getRegistration()
      if (cancelled || !reg) return

      if (reg.waiting && hasController()) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        return
      }

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        installing?.addEventListener('statechange', () => {
          if (
            !cancelled &&
            installing.state === 'installed' &&
            hasController()
          ) {
            installing.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })
    }

    const register = async (): Promise<void> => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none'
        })
        await registration.update()
        await detect()
      } catch {
        // A failed registration must never break the app (§11)
      }
    }

    void register()

    // Keep long-lived PWA sessions on the latest bundle. This is intentionally
    // automatic because stale application code can also keep an obsolete
    // IndexedDB migration path alive.
    const reloadOnControllerChange = (): void => {
      location.reload()
    }
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      reloadOnControllerChange
    )

    // Periodic update check while open.
    const interval = setInterval(() => {
      void navigator.serviceWorker.getRegistration().then((reg) => {
        void reg?.update().then(() => detect())
      })
    }, 60_000)

    return () => {
      cancelled = true
      clearInterval(interval)
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        reloadOnControllerChange
      )
    }
  }, [])

  return null
}
