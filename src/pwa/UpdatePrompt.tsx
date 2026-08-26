import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** Update prompt for registerType: 'prompt' (§11). Without this UI the new
 *  service worker would wait forever while the old one keeps serving.
 *
 *  Known limitations:
 *  - The very first update after a long-lived old SW can show this banner
 *    twice in a row before settling. Harmless — a second tap always
 *    finishes it.
 *  - Deploying several versions in quick succession can strand a device's
 *    SW in permanent "installing": the new revision precaches hashed assets
 *    that a later deploy already pruned (404). Symptom: endless update
 *    banner while the active version works fine. Remedy on the device:
 *    unregister the worker (chrome://serviceworker-internals) or reinstall.
 *    Prevention: let each deploy settle before shipping the next one. */
export const UpdatePrompt = () => {
  const { needRefresh, updateServiceWorker } = useRegisterSW()
  const [updating, setUpdating] = useState(false)

  if (!needRefresh || updating) return null

  const update = (): void => {
    // Hide the banner optimistically: the reload races against the
    // activation event and would otherwise re-show it
    setUpdating(true)
    void updateServiceWorker(true)
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
