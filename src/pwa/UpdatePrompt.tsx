import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** Update prompt for registerType: 'prompt' (§11). Without this UI the new
 *  service worker would wait forever while the old one keeps serving. */
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
