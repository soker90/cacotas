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
import { HouseholdEntry, type HouseholdEntryAction } from './pages/HouseholdEntry/index.tsx'

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
  const [startupReady, setStartupReady] = useState(false)

  const localBabyId = localBaby?.id

  useEffect(() => {
    if (sessionToken === null || localBabyId === undefined || backend === null) {
      return
    }

    let cancelled = false
    void db.babies.get(localBabyId).then((currentLocalBaby) => {
      if (currentLocalBaby === undefined) return undefined
      return resolveStartup(currentLocalBaby, backend, getDeviceId())
    }).then(async (decision) => {
      if (cancelled || decision === undefined) {
        if (!cancelled) setStartupReady(true)
        return
      }
      if (decision.route === 'ONBOARDING' && decision.remote === undefined) {
        await db.transaction('rw', db.babies, db.movements, db.weights, db.locations, async () => {
          await db.babies.clear()
          await db.movements.clear()
          await db.weights.clear()
          await db.locations.clear()
        })
        if (!cancelled) setStartupReady(true)
        return
      }
      if (decision.remote === undefined) {
        if (!cancelled) setStartupReady(true)
        return
      }

      const { baby, movements, weights, locations } = decision.remote
      const currentLocalBaby = await db.babies.get(localBabyId)
      if (currentLocalBaby === undefined) {
        if (!cancelled) setStartupReady(true)
        return
      }
      await db.transaction('rw', db.babies, db.movements, db.weights, db.locations, async () => {
        const localMovements = await db.movements.where('babyId').equals(currentLocalBaby.id).toArray()
        const localWeights = await db.weights.where('babyId').equals(currentLocalBaby.id).toArray()
        if (baby.id !== currentLocalBaby.id) {
          await db.movements.clear()
          await db.weights.clear()
          await db.babies.clear()
          await db.locations.clear()
        } else {
          await db.movements.bulkDelete(localMovements.filter((row) => row.serverSeq > 0).map((row) => row.id))
          await db.weights.bulkDelete(localWeights.filter((row) => row.serverSeq > 0).map((row) => row.id))
        }
        await db.babies.put(baby)
        await db.movements.bulkPut(movements)
        await db.weights.bulkPut(weights)
        await db.locations.bulkPut(locations)
      })
      if (!cancelled) setStartupReady(true)
    }).catch(() => {
      if (!cancelled) setStartupReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [backend, localBabyId, sessionToken])

  if (sessionToken === null) {
    return <Login onLogin={() => { rerender((value) => value + 1) }} />
  }

  if (localBaby === undefined || (localBaby !== null && backend !== null && !startupReady)) {
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
  const [entryAction, setEntryAction] = useState<HouseholdEntryAction | null>(null)
  const [decision, setDecision] = useState<StartupDecision | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (entry || entryAction !== 'JOIN') return
    let cancelled = false
    void resolveStartup(null, backend, getDeviceId()).then((d) => {
      if (!cancelled) setDecision(d)
    })
    return () => {
      cancelled = true
    }
  }, [entry, entryAction, backend, retryCount])

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
      ? <HouseholdEntry onDone={(action) => { setEntryAction(action); setEntry(false) }} />
      : <HouseholdEntry inviteCode={inviteCode} onDone={(action) => { setEntryAction(action); setEntry(false) }} />
  }

  if (entryAction === 'CREATE') {
    return <Onboarding />
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
            setRetryCount((value) => value + 1)
          }}
        >
          Reintentar
        </button>
      </main>
    )
  }

  return <Onboarding />
}
