import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { AppLayout } from './layout/AppLayout.tsx'
import { db, seedSizes } from './db/index.ts'
import { useBaby } from './hooks'
import {
  resolveStartup,
  type StartupDecision,
} from './sync/resolve-startup.ts'
import { Home } from './pages/Home/index.tsx'
import { Onboarding } from './pages/Onboarding/index.tsx'
import { Inventory } from './pages/Inventory/index.tsx'
import { SizeDetail } from './pages/SizeDetail/index.tsx'
import { RecordMultiple } from './pages/RecordMultiple/index.tsx'
import { History } from './pages/History/index.tsx'
import { Settings } from './pages/Settings/index.tsx'
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx'
import { HttpSyncBackend } from './sync/http-backend.ts'
import { startSyncLoop } from './sync/scheduler.ts'
import { getDeviceId } from './sync/device-id.ts'

void seedSizes(db)

/** §9.7: with the sync secret configured at build time the backend is real
 *  and the startup flow can adopt a remote baby; without it everything
 *  stays local (first device). */
const SYNC_URL = import.meta.env.VITE_SYNC_URL
const SYNC_SECRET = import.meta.env.VITE_SYNC_SECRET
const backend =
  typeof SYNC_URL === 'string' &&
  SYNC_URL !== '' &&
  typeof SYNC_SECRET === 'string' &&
  SYNC_SECRET !== ''
    ? new HttpSyncBackend(SYNC_URL, SYNC_SECRET)
    : null

export const App = () => (
  <BrowserRouter>
    <UpdatePrompt />
    <AppRoutes />
  </BrowserRouter>
)

const AppRoutes = () => {
  // undefined = still loading; null = no baby yet (§9.7)
  const localBaby = useBaby()

  if (localBaby === undefined) {
    return <main className='loading'>…</main>
  }
  if (!localBaby) {
    return <FirstLaunch />
  }

  return (
    <>
      <SyncLoop />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path='/' element={<Home baby={localBaby} />} />
          <Route path='/record' element={<RecordMultiple baby={localBaby} />} />
          <Route path='/inventory' element={<Inventory baby={localBaby} />} />
          <Route
            path='/inventory/:sizeId'
            element={<SizeDetail baby={localBaby} />}
          />
          <Route path='/history' element={<History baby={localBaby} />} />
          <Route path='/settings' element={<Settings />} />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Route>
      </Routes>
    </>
  )
}

/** Mounts the sync triggers for as long as a local baby exists (§9.3). */
const SyncLoop = () => {
  useEffect(() => {
    startSyncLoop(backend, getDeviceId())
  }, [])
  return null
}

/** Startup flow of §9.7 when there is no local Baby. */
const FirstLaunch = () => {
  const [decision, setDecision] = useState<StartupDecision | null>(null)

  useEffect(() => {
    let cancelled = false
    void resolveStartup(null, backend).then((d) => {
      if (!cancelled) setDecision(d)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Adoption path: a remote baby was found, persist it and go straight to
  // Home, skipping the onboarding entirely. Unreachable while backend is
  // null; exercised by unit tests and wired up in phase 3.
  useEffect(() => {
    if (decision?.route !== 'HOME' || !decision.remote) return
    const { baby, movements } = decision.remote
    void db.transaction('rw', db.babies, db.movements, async () => {
      await db.babies.put(baby)
      await db.movements.bulkPut(movements)
    })
  }, [decision])

  if (decision === null) {
    return <main className='loading'>…</main>
  }

  // Unreachable in phase 1: there is no backend to fail.
  if (decision.route === 'JOIN_RETRY') {
    return (
      <main className='onboarding'>
        <p>No se pudo comprobar si ya hay datos sincronizados.</p>
        <button
          type='button'
          onClick={() => {
            setDecision(null)
          }}
        >
          Reintentar
        </button>
      </main>
    )
  }

  return <Onboarding />
}
