import { toast } from 'sonner'
import { useState } from 'react'
import { api } from '../../lib/api'
import { Network, X, Play, Square, ArrowRightLeft } from 'lucide-react'

interface TunnelModalProps {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Forward {
  id: number
  type: string
  localPort: string
  remoteHost: string
  remotePort: string
}

export function TunnelModal({
  sessionId,
  open,
  onOpenChange
}: TunnelModalProps): React.JSX.Element | null {
  const [activeForwards, setActiveForwards] = useState<Forward[]>([])
  const [formData, setFormData] = useState({
    type: 'local',
    localPort: '',
    remoteHost: '127.0.0.1',
    remotePort: ''
  })

  const handleStart = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      await api.post(`/tunnels/${sessionId}/start`, formData)
      setActiveForwards([...activeForwards, { ...formData, id: Date.now() }])
      setFormData({ type: 'local', localPort: '', remoteHost: '127.0.0.1', remotePort: '' })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg ?? 'Failed to start tunnel')
    }
  }

  const handleStop = async (forward: Forward): Promise<void> => {
    try {
      await api.post(`/tunnels/${sessionId}/stop`, {
        type: forward.type,
        port: forward.type === 'local' ? forward.localPort : forward.remotePort
      })
      setActiveForwards(activeForwards.filter((f) => f.id !== forward.id))
    } catch {
      toast.error('Failed to stop tunnel')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#0f1117] border border-slate-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center">
              <Network className="w-4 h-4 text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-200">Port Forwarding</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-slate-500 hover:text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <form
            onSubmit={handleStart}
            className="space-y-4 bg-[#151821] p-4 rounded-lg border border-slate-800"
          >
            <h3 className="text-sm font-medium text-slate-300">Create New Forward</h3>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 mb-1">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded px-3 py-1.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="local">Local (L)</option>
                  <option value="remote">Remote (R)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 mb-1">Local Port</label>
                <input
                  required
                  type="number"
                  value={formData.localPort}
                  onChange={(e) => setFormData({ ...formData, localPort: e.target.value })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded px-3 py-1.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="e.g. 8080"
                />
              </div>

              <div className="pt-4 px-2 text-slate-600">
                <ArrowRightLeft className="w-4 h-4" />
              </div>

              <div className="flex-[2]">
                <label className="block text-xs text-slate-500 mb-1">
                  Remote Target (Host:Port)
                </label>
                <div className="flex gap-2">
                  <input
                    required
                    type="text"
                    value={formData.remoteHost}
                    onChange={(e) => setFormData({ ...formData, remoteHost: e.target.value })}
                    className="w-full bg-[#1a1c23] border border-slate-800 rounded px-3 py-1.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="localhost"
                    disabled={formData.type === 'remote'} // Remote forwards typically point to localhost on the client side
                  />
                  <input
                    required
                    type="number"
                    value={formData.remotePort}
                    onChange={(e) => setFormData({ ...formData, remotePort: e.target.value })}
                    className="w-24 bg-[#1a1c23] border border-slate-800 rounded px-3 py-1.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="80"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-medium flex items-center justify-center gap-2 transition-colors text-sm"
            >
              <Play className="w-4 h-4" /> Start Forwarding
            </button>
          </form>

          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Active Forwards</h3>
            {activeForwards.length === 0 ? (
              <div className="text-sm text-slate-500 italic text-center py-4 bg-[#151821] rounded-lg border border-slate-800 border-dashed">
                No active port forwards
              </div>
            ) : (
              <div className="space-y-2">
                {activeForwards.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between bg-[#151821] border border-slate-800 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${f.type === 'local' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-purple-500/10 text-purple-500'}`}
                      >
                        {f.type === 'local' ? 'L' : 'R'}
                      </span>
                      <span className="text-slate-300 text-sm font-mono">
                        {f.localPort} ↔ {f.remoteHost}:{f.remotePort}
                      </span>
                    </div>
                    <button
                      onClick={() => handleStop(f)}
                      className="text-red-400 hover:text-red-300 p-1.5 hover:bg-red-500/10 rounded transition-colors"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
