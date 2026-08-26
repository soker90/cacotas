import { useEffect, useState } from 'react'

/**
 * Update prompt for registerType: 'prompt' (§11), hand-rolled over the raw
 * service worker API. The plugin's workbox-window wrapper kept firing the
 * prompt spuriously (stuck needRefresh with no waiting worker).
 *
 * Flow: register /sw.js · when an updated worker reaches `installed` show
 * the banner · Actualizar posts SKIP_WAITING and reloads on controllerchange.
 */
export const UpdatePrompt = () => {
  const [waiting, setWaiting] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    let cancelled = false

    // First-ever visit: nothing controls the page yet, the first install
    // must stay silent (no "update" prompt for content never seen).
    const hasController = (): boolean =>
      !!navigator.serviceWorker.controller

    const detect = async (): Promise<void> => {
      const reg = await navigator.serviceWorker.getRegistration()
      if (cancelled || !reg) return

      if (
        reg.waiting &&
        hasController() &&
        reg.waiting.scriptURL === navigator.serviceWorker.controller?.scriptURL
      ) {
        setWaiting(true)
      }

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        installing?.addEventListener('statechange', () => {
          if (
            !cancelled &&
            installing.state === 'installed' &&
            hasController()
          ) {
            setWaiting(true)
          }
        })
      })
    }

    const register = async (): Promise<void> => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        await detect()
      } catch {
        // A failed registration must never break the app (§11)
      }
    }

    void register()

    // Periodic update check (§9.3 spirit): every 60 s while open
    const interval = setInterval(() => {
      void navigator.serviceWorker.getRegistration().then((reg) => {
        void reg?.update().then(() => detect())
      })
    }, 60_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (!waiting || updating) return null

  const update = (): void => {
    setUpdating(true)
    void navigator.serviceWorker.getRegistration().then((reg) => {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          location.reload()
        },
        { once: true }
      )
      reg?.waiting?.postMessage({ type: 'SKIP_WAITING' })
    })
  }

  return (
    <div className='update-banner' role='alert'>
      <span>Hay una versión nueva disponible</span>
      <button type='button' onClick={update}>
        Actualizar
      </button>
    </div>
  )
}
