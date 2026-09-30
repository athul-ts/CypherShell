import { useState } from 'react'
import { api } from '../lib/api'

interface SetupWizardProps {
  onComplete: () => void
}

export default function SetupWizard({ onComplete }: SetupWizardProps): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSkipConfirm, setShowSkipConfirm] = useState(false)

  const handleSetPassword = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    if (password.length < 6) return setError('Password must be at least 6 characters.')
    if (password !== confirm) return setError('Passwords do not match.')

    setLoading(true)
    try {
      const { data } = await api.post('/auth/setup', { password })
      sessionStorage.setItem('jwt', data.token)
      onComplete()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || 'Setup failed. Please restart the app.')
    } finally {
      setLoading(false)
    }
  }

  const handleSkip = async (): Promise<void> => {
    setLoading(true)
    try {
      const { data } = await api.post('/auth/setup/skip')
      sessionStorage.setItem('jwt', data.token)
      onComplete()
    } catch {
      setError('Setup failed. Please restart the app.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0f1117]">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-emerald-900/40">
            <svg
              className="w-9 h-9 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Welcome to CypherShell</h1>
          <p className="text-slate-400 mt-1 text-sm">
            Create a master password to protect your SSH credentials
          </p>
        </div>

        <div className="bg-[#1a1d27] border border-white/[0.07] rounded-2xl p-8 shadow-2xl">
          {!showSkipConfirm ? (
            <form onSubmit={handleSetPassword} className="space-y-5">
              <div>
                <label className="text-sm font-medium text-slate-300 block mb-2">
                  Master Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl bg-[#0f1117] border border-white/[0.1] text-white placeholder-slate-600
                    focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50
                    transition-all duration-200 text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-300 block mb-2">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-4 py-3 rounded-xl bg-[#0f1117] border border-white/[0.1] text-white placeholder-slate-600
                    focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50
                    transition-all duration-200 text-sm"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl px-4 py-3 text-sm">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9v4a1 1 0 102 0V9a1 1 0 10-2 0zm0-4a1 1 0 112 0 1 1 0 01-2 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {error}
                </div>
              )}

              <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-xl px-4 py-3 text-xs text-emerald-400/80">
                🔐 Your password encrypts all SSH keys and credentials with AES-256-GCM. It is never
                stored — only a bcrypt hash is saved.
              </div>

              <button
                id="save-password-btn"
                type="submit"
                disabled={loading || !password || !confirm}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold text-sm
                  hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200 shadow-lg shadow-emerald-900/30 active:scale-[0.99]"
              >
                {loading ? 'Saving…' : 'Set Password & Continue'}
              </button>

              <p className="text-center text-xs text-slate-600 pt-1">
                <button
                  type="button"
                  onClick={() => setShowSkipConfirm(true)}
                  className="hover:text-slate-500 underline underline-offset-2 transition-colors"
                >
                  Continue without a password (not recommended)
                </button>
              </p>
            </form>
          ) : (
            <div className="space-y-5 text-center">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
                <svg
                  className="w-7 h-7 text-amber-400"
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
                <h2 className="text-lg font-semibold text-white">Are you sure?</h2>
                <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                  Without a master password, all SSH credentials are stored{' '}
                  <span className="text-amber-400 font-medium">without encryption</span>. Anyone
                  with access to this machine can read them.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSkipConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/[0.08] text-slate-300 text-sm font-medium hover:bg-white/10 transition-colors"
                >
                  ← Go back
                </button>
                <button
                  id="setup-skip-btn"
                  type="button"
                  onClick={handleSkip}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl bg-amber-600/20 border border-amber-600/30 text-amber-400 text-sm font-medium hover:bg-amber-600/30 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Setting up…' : 'Continue without password'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
