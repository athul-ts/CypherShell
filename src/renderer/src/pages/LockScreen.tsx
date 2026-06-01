import { useState } from 'react';
import { api } from '../lib/api';

interface LockScreenProps {
  onUnlocked: () => void;
}

export default function LockScreen({ onUnlocked }: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/unlock', { password });
      sessionStorage.setItem('jwt', data.token);
      onUnlocked();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Incorrect password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0f1117]">
      <div className="w-full max-w-md">
        {/* Logo area */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-emerald-900/40">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">CypherShell</h1>
          <p className="text-slate-400 mt-1 text-sm">Enter your master password to unlock</p>
        </div>

        {/* Card */}
        <div className="bg-[#1a1d27] border border-white/[0.07] rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleUnlock} className="space-y-5">
            <div>
              <label className="text-sm font-medium text-slate-300 block mb-2">Master Password</label>
              <input
                id="master-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoFocus
                className="w-full px-4 py-3 rounded-xl bg-[#0f1117] border border-white/[0.1] text-white placeholder-slate-600
                  focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50
                  transition-all duration-200 text-sm"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl px-4 py-3 text-sm">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9v4a1 1 0 102 0V9a1 1 0 10-2 0zm0-4a1 1 0 112 0 1 1 0 01-2 0z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <button
              id="unlock-btn"
              type="submit"
              disabled={loading || !password}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold text-sm
                hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200 shadow-lg shadow-emerald-900/30 active:scale-[0.99]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Unlocking…
                </span>
              ) : 'Unlock'}
            </button>
          </form>

          <p className="text-center mt-5 text-xs text-slate-600">
            Lost your password? All encrypted data will be unrecoverable.
          </p>
        </div>
      </div>
    </div>
  );
}
