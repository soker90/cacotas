import { useEffect, useMemo, useState } from 'react'
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
import { Stats } from './pages/Stats/index.tsx'
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx'
import { HttpSyncBackend } from './sync/http-backend.ts'
import { startSyncLoop } from './sync/scheduler.ts'
import { getDeviceId } from './sync/device-id.ts'
import { getSessionToken } from './auth/session.ts'
import { Login } from './pages/Login/index.tsx'
import { HouseholdEntry } from './pages/HouseholdEntry/index.tsx'

void seedSizes(db)

const createBackend = (sessionToken: string | null): HttpSyncBackend | null => {
  const url = import.meta.env.VITE_SYNC_URL
  return typeof url === 'string' && url !== '' && sessionToken !== null
    ? new HttpSyncBackend(url, sessionToken)
    : null
}

export const App = () => (
  <BrowserRouter>
    <UpdatePrompt />
    <AppRoutes />
  </BrowserRouter>
)

const AppRoutes = () => {
  const localBaby = useBaby()
  const [, rerender] = useState(0)
  const sessionToken = getSessionToken()
  const backend = useMemo(() => createBackend(sessionToken), [sessionToken])

  if (sessionToken === null) {
    return <Login onLogin={() => { rerender((value) => value + 1) }} />
  }

  if (localBaby === undefined) {
    return <main className='loading'>…</main>
  }
  if (!localBaby) {
    const inviteMatch = window.location.pathname.match(/^\/invite\/([^/]+)$/)
    const inviteCode = inviteMatch?.[1]
    return inviteCode === undefined
      ? <FirstLaunch backend={backend} />
      : <FirstLaunch backend={backend} inviteCode={inviteCode} />
  }

  return (
    <>
      <SyncLoop backend={backend} />
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
          <Route path='/stats' element={<Stats />} />
          <Route path='/settings' element={<Settings />} />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Route>
      </Routes>
    </>
  )
}

const SyncLoop = ({ backend }: { backend: HttpSyncBackend | null }) => {
  useEffect(() => {
    startSyncLoop(backend, getDeviceId())
  }, [backend])
  return null
}

const FirstLaunch = ({ backend, inviteCode }: { backend: HttpSyncBackend | null; inviteCode?: string }) => {
  const [entry, setEntry] = useState(true)
  const [decision, setDecision] = useState<StartupDecision | null>(null)

  useEffect(() => {
    if (entry) return
    let cancelled = false
    void resolveStartup(null, backend, getDeviceId()).then((d) => {
      if (!cancelled) setDecision(d)
    })
    return () => {
      cancelled = true
    }
  }, [entry, backend])

  useEffect(() => {
    if (decision?.route !== 'HOME' || !decision.remote) return
    const { baby, movements, locations } = decision.remote
    void db.transaction('rw', db.babies, db.movements, db.locations, async () => {
      await db.babies.put(baby)
      await db.movements.bulkPut(movements)
      await db.locations.bulkPut(locations)
    })
  }, [decision])

  if (entry) {
    return inviteCode === undefined
      ? <HouseholdEntry onDone={() => { setEntry(false) }} />
      : <HouseholdEntry inviteCode={inviteCode} onDone={() => { setEntry(false) }} />
  }

  if (decision === null) {
    return <main className='loading'>…</main>
  }

  if (decision.route === 'JOIN_RETRY') {
    return (
      <main className='onboarding'>
        <p>No se pudo comprobar si ya hay datos sincronizados.</p>
        {decision.reason && (
          <p className='muted small'>{decision.reason}</p>
        )}
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
