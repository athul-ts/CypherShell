import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api'

interface KnownHost {
  id: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  lastSeenAt: string
}

/** Settings → Known Hosts (BL-38): the SSH host keys the user has trusted. */
export function KnownHostsCard(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['known-hosts'],
    queryFn: async (): Promise<KnownHost[]> => (await api.get<KnownHost[]>('/known-hosts')).data
  })
  const hosts = Array.isArray(data) ? data : []

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/known-hosts/${id}`),
    onSuccess: () => {
      setConfirming(null)
      queryClient.invalidateQueries({ queryKey: ['known-hosts'] })
      toast.success('Known host removed. You will be asked to trust it again.')
    },
    onError: () => toast.error('Could not remove the known host.')
  })

  return (
    <div className="bg-[#151821] border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-slate-400" />
        <h2 className="font-semibold text-slate-200">Known Hosts</h2>
      </div>
      <div className="p-6 space-y-3">
        {hosts.length === 0 ? (
          <p className="text-sm text-slate-500">
            No trusted hosts yet. A host appears here after you confirm its key on first connect.
          </p>
        ) : (
          hosts.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between gap-4 p-4 bg-[#1a1c23] rounded-lg border border-slate-800"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-200">
                  {h.host}:{h.port}
                </div>
                <div className="text-xs text-slate-500 mt-1">{h.keyType}</div>
                <div className="font-mono text-xs text-slate-400 break-all">{h.fingerprint}</div>
                <div className="text-xs text-slate-600 mt-1">
                  Last seen {new Date(h.lastSeenAt).toLocaleString()}
                </div>
              </div>
              {confirming === h.id ? (
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-white/5 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(h.id)}
                    className="px-3 py-1.5 rounded-lg text-sm text-red-400 bg-red-900/30 hover:bg-red-900/50 disabled:opacity-50"
                  >
                    Confirm remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(h.id)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-white/5 hover:bg-white/10"
                >
                  Remove
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
