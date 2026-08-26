import { useRegisterSW } from 'virtual:pwa-register/react'

/** Update prompt for registerType: 'prompt' (§11). Without this UI the new
 *  service worker would wait forever while the old one keeps serving. */
export const UpdatePrompt = () => {
  const { needRefresh, updateServiceWorker } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className='update-banner' role='alert'>
      <span>Hay una versión nueva disponible</span>
      <button
        type='button'
        onClick={() => {
          void updateServiceWorker(true)
        }}
      >
        Actualizar
      </button>
    </div>
  )
}
