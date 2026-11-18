import { useEffect, useState } from 'react'
import { Toaster } from './components/ui/sonner'
import { api, setUnauthorizedHandler } from './lib/api'
import LockScreen from './pages/LockScreen'
import SetupWizard from './pages/SetupWizard'
import { HashRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { Sidebar } from './components/layout/Sidebar'
import { ProfileDetailPane } from './components/profiles/ProfileDetailPane'
import Home from './pages/Home'
import Keys from './pages/Keys'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import { TabBar } from './components/terminal/TabBar'
import { UpdateBanner } from './components/layout/UpdateBanner'
import { useTabStore } from './store/tabStore'
import { TerminalPane } from './components/terminal/TerminalPane'
import { SftpPane } from './components/sftp/SftpPane'
import { cn } from './lib/utils'

type AppState = 'loading' | 'setup' | 'locked' | 'unlocked' | 'error'

interface AppConfig {
  theme?: string
}

/** Terminal and SFTP windows are opened by main on `#/connection/<type>/<sessionId>`. */
function isConnectionWindowHash(hash: string): boolean {
  return hash.startsWith('#/connection/')
}

function StandaloneTerminal(): React.JSX.Element {
  const { sessionId } = useParams()
  return <TerminalPane sessionId={sessionId || ''} />
}

function StandaloneSftp(): React.JSX.Element {
  const { sessionId } = useParams()
  return <SftpPane sessionId={sessionId || ''} />
}

// FR-07.5 / BL-18: auto-lock is no longer timed here. The main process keeps
// one idle clock for every window and announces a lock with `app:locked`.
function AppContent(): React.JSX.Element {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const location = useLocation()
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api
      .get('/config')
      .then((res) => setConfig(res.data))
      .catch(console.error)
  }, [])

  // UX-02: Apply theme class from config
  useEffect(() => {
    const theme = config?.theme || 'dark'
    document.documentElement.classList.toggle('light', theme === 'light')
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      document.documentElement.classList.toggle('light', mq.matches)
      const handleChange = (e: MediaQueryListEvent): void => {
        document.documentElement.classList.toggle('light', e.matches)
      }
      mq.addEventListener('change', handleChange)
      return (): void => mq.removeEventListener('change', handleChange)
    }
    return undefined
  }, [config])

  const isConnectionWindow = location.pathname.startsWith('/connection/')

  if (isConnectionWindow) {
    return (
      <main className="w-full h-full bg-[#0a0a0f] overflow-hidden relative">
        <Routes>
          <Route path="/connection/terminal/:sessionId" element={<StandaloneTerminal />} />
          <Route path="/connection/sftp/:sessionId" element={<StandaloneSftp />} />
        </Routes>
      </main>
    )
  }

  return (
    <div className="flex h-screen w-full bg-[#0a0a0f] text-slate-200 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <UpdateBanner />
        {tabs.length > 0 && <TabBar />}
        <main className="flex-1 h-full overflow-hidden relative">
          <div className={cn('absolute inset-0', activeTabId === 'home' ? 'block' : 'hidden')}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/keys" element={<Keys />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>

          {tabs
            .filter((tab) => tab.id !== 'home')
            .map((tab) => (
              <div
                key={tab.id}
                className={cn('absolute inset-0', activeTabId === tab.id ? 'block' : 'hidden')}
              >
                {tab.type === 'profile-detail' && <ProfileDetailPane profileId={tab.profileId} />}
              </div>
            ))}
        </main>
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>('loading')

  useEffect(() => {
    async function initToken(): Promise<void> {
      // SEC-07 / BL-20: a connection window claims the token main holds for
      // it, once, over IPC. A token in the URL is never read.
      if (!isConnectionWindowHash(window.location.hash)) return
      const connectionToken = await window.api.getConnectionToken()
      if (connectionToken) sessionStorage.setItem('jwt', connectionToken)
    }

    initToken()
      .catch(() => undefined) // without a token the status check re-authenticates
      .then(() => checkStatus(12)) // 12 retries × 1 s = up to 12 s while backend starts
  }, [])

  // BL-18: the app locked (idle timeout or a lock request) — drop the token
  // and show the lock screen at once. Main closes the connection windows.
  useEffect(() => {
    const unsubscribe = window.api.onAppLocked?.(() => {
      sessionStorage.removeItem('jwt')
      setState('locked')
    })
    return () => unsubscribe?.()
  }, [])

  // BL-16: when the backend rejects the token — it expired, was revoked by a
  // lock, or the backend restarted — run the auth check again: with lock off
  // a new token is issued silently, with lock on the lock screen appears.
  useEffect(() => {
    let inFlight = false
    const reauthenticate = (): void => {
      if (inFlight) return
      inFlight = true
      sessionStorage.removeItem('jwt')
      checkStatus(12).finally(() => {
        inFlight = false
      })
    }
    setUnauthorizedHandler(reauthenticate)
    const unsubscribe = window.api.onBackendRestarted?.(reauthenticate)
    return () => {
      setUnauthorizedHandler(null)
      unsubscribe?.()
    }
  }, [])

  async function checkStatus(retriesLeft: number): Promise<void> {
    try {
      const { data } = await api.get('/auth/status')
      if (!data.configured) {
        setState('setup')
      } else if (data.locked) {
        // Bypass the LockScreen if we already hold a token in sessionStorage
        const token = sessionStorage.getItem('jwt')
        if (token) {
          setState('unlocked')
        } else {
          setState('locked')
        }
      } else {
        // No lock — auto-issue a token
        const r = await api.post('/auth/unlock', { password: '' })
        sessionStorage.setItem('jwt', r.data.token)
        setState('unlocked')
      }
    } catch {
      if (retriesLeft > 0) {
        setTimeout(() => checkStatus(retriesLeft - 1), 1000)
      } else {
        setState('error') // Backend truly unreachable — show clear error
      }
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0f1117]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" />
          <p className="text-slate-500 text-sm">Starting…</p>
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0f1117]">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg
              className="w-7 h-7 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-semibold text-lg">Backend failed to start</h2>
            <p className="text-slate-400 text-sm mt-2">
              The local server could not be reached after 12 seconds. Check the application logs or
              try restarting.
            </p>
          </div>
          <button
            onClick={() => {
              setState('loading')
              checkStatus(12)
            }}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (state === 'setup') {
    return <SetupWizard onComplete={() => setState('unlocked')} />
  }

  if (state === 'locked') {
    return <LockScreen onUnlocked={() => setState('unlocked')} />
  }

  return (
    <HashRouter>
      <AppContent />
      <Toaster position="bottom-right" richColors />
    </HashRouter>
  )
}
