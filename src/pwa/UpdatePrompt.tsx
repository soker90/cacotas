import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** Update prompt for registerType: 'prompt' (§11). Without this UI the new
 *  service worker would wait forever while the old one keeps serving.
 *
 *  Known limitation: the very first update after a long-lived old SW can
 *  show this banner twice in a row before settling (documented upstream in
 *  vite-plugin-pwa's prompt flow). Harmless — a second tap always finishes
 *  it. Not worth chasing further; `clientsClaim` already reduces it to at
 *  most one extra cycle. */
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
