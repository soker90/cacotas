import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initSentry } from './lib/sentry.ts'
import { App } from './App.tsx'
import './styles.css'

initSentry()

// The service worker is registered by <UpdatePrompt /> (useRegisterSW),
// keeping a single registration path.

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
