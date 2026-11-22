import { toast } from 'sonner'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  Server,
  TerminalSquare,
  FolderOpen,
  Loader2,
  Power,
  Wifi,
  Shield,
  Box,
  Play,
  Square,
  ArrowRightLeft,
  Pencil,
  Save,
  Trash2
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { ProfileForm } from './ProfileForm'
import { useSessionHeartbeat } from '../../hooks/useSessionHeartbeat'
import { HostKeyDialog, type HostKeyInfo } from './HostKeyDialog'

interface ProfileDetailPaneProps {
  profileId: string
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting'

interface Profile {
  id: string
  name: string
  group?: string | null
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key' | 'key+passphrase'
  sshKeyId?: string | null
  hasPassword?: boolean
}

type TunnelType = 'local' | 'remote' | 'dynamic'

interface TunnelForm {
  type: TunnelType
  localPort: string
  remoteHost: string
  remotePort: string
}

interface ActiveForward extends TunnelForm {
  id: number
}

/** A saved port-forwarding rule (FR-06.4, BL-34). */
interface SavedRule {
  id: string
  type: TunnelType
  localPort: number
  remoteHost: string | null
  remotePort: number | null
  label: string | null
}

function ruleToForm(rule: SavedRule): TunnelForm {
  return {
    type: rule.type,
    localPort: String(rule.localPort),
    remoteHost: rule.remoteHost ?? '127.0.0.1',
    remotePort: rule.remotePort == null ? '' : String(rule.remotePort)
  }
}

function describeRule(rule: SavedRule): string {
  if (rule.type === 'dynamic') return `SOCKS5 proxy on :${rule.localPort}`
  if (rule.type === 'remote') return `:${rule.remotePort} ↔ localhost:${rule.localPort}`
  return `${rule.localPort} ↔ ${rule.remoteHost}:${rule.remotePort}`
}

function apiErrorText(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error
}

interface TerminalWindowApi {
  openTerminalWindow: (sessionId: string, profileId: string, title: string, token: string) => void
  openSftpWindow: (sessionId: string, profileId: string, title: string, token: string) => void
}

export function ProfileDetailPane({ profileId }: ProfileDetailPaneProps): React.JSX.Element {
  const [localStatus, setStatus] = useState<ConnectionStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const [hostKey, setHostKey] = useState<HostKeyInfo | null>(null)

  // Tunnels state
  const [activeForwards, setActiveForwards] = useState<ActiveForward[]>([])
  const [tunnelForm, setTunnelForm] = useState<TunnelForm>({
    type: 'local',
    localPort: '',
    remoteHost: '127.0.0.1',
    remotePort: ''
  })

  const { data: profile, isLoading } = useQuery<Profile | undefined>({
    queryKey: ['profile', profileId],
    queryFn: async () => {
      const res = await api.get(`/profiles`)
      return (res.data as Profile[]).find((p) => p.id === profileId)
    }
  })

  // BL-11: while connected, keep the session leased and notice when it ends
  // (closed by the server, the network, or the backend's idle reaper).
  const { ended: sessionEnded, reconnecting } = useSessionHeartbeat(
    sessionId,
    localStatus === 'connected'
  )
  const status: ConnectionStatus =
    localStatus === 'connected' && sessionEnded ? 'disconnected' : localStatus

  /** BL-38: `acceptHostKey` is the fingerprint the user confirmed in the host-key dialog. */
  const handleConnect = async (acceptHostKey?: string): Promise<void> => {
    setActiveForwards([])
    setStatus('connecting')
    setHostKey(null)
    try {
      const res = acceptHostKey
        ? await api.post(`/profiles/${profileId}/connect`, { acceptHostKey })
        : await api.post(`/profiles/${profileId}/connect`)
      setSessionId(res.data.sessionId)
      setStatus('connected')
    } catch (error) {
      setStatus('disconnected')
      const data = (error as { response?: { status?: number; data?: HostKeyInfo } }).response
      if (data?.status === 409 && data.data?.code?.startsWith('HOST_KEY_')) {
        setHostKey(data.data)
        return
      }
      console.error('Failed to connect:', error)
      toast.error('Connection failed. Please check the profile settings and try again.')
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    if (!sessionId) return
    setStatus('disconnecting')
    try {
      await api.delete(`/sessions/${sessionId}`)
    } catch (error) {
      console.error('Failed to disconnect:', error)
      toast.error('Failed to disconnect gracefully. The session may still be active.')
    } finally {
      setSessionId(null)
      setActiveForwards([])
      setStatus('disconnected')
    }
  }

  const handleOpenTerminal = (): void => {
    if (!sessionId || status !== 'connected') return
    const token = sessionStorage.getItem('jwt') || ''
    ;(window.api as unknown as TerminalWindowApi).openTerminalWindow(
      sessionId,
      profileId,
      profile?.name || 'Terminal',
      token
    )
  }

  const handleOpenSftp = (): void => {
    if (!sessionId || status !== 'connected') return
    const token = sessionStorage.getItem('jwt') || ''
    ;(window.api as unknown as TerminalWindowApi).openSftpWindow(
      sessionId,
      profileId,
      profile?.name || 'SFTP',
      token
    )
  }

  const queryClient = useQueryClient()
  const { data: savedRulesData } = useQuery<SavedRule[]>({
    queryKey: ['tunnels', profileId],
    queryFn: async () => (await api.get<SavedRule[]>(`/profiles/${profileId}/tunnels`)).data
  })
  const savedRules = Array.isArray(savedRulesData) ? savedRulesData : []

  /** BL-34: keep the current form as a rule of this profile. */
  const handleSaveRule = async (): Promise<void> => {
    try {
      await api.post(`/profiles/${profileId}/tunnels`, {
        type: tunnelForm.type,
        localPort: tunnelForm.localPort,
        remoteHost: tunnelForm.type === 'local' ? tunnelForm.remoteHost : undefined,
        remotePort: tunnelForm.type === 'dynamic' ? undefined : tunnelForm.remotePort
      })
      queryClient.invalidateQueries({ queryKey: ['tunnels', profileId] })
      toast.success('Tunnel rule saved')
    } catch (err) {
      toast.error(apiErrorText(err) ?? 'Failed to save tunnel rule')
    }
  }

  const handleDeleteRule = async (rule: SavedRule): Promise<void> => {
    try {
      await api.delete(`/profiles/${profileId}/tunnels/${rule.id}`)
      queryClient.invalidateQueries({ queryKey: ['tunnels', profileId] })
    } catch (err) {
      toast.error(apiErrorText(err) ?? 'Failed to delete tunnel rule')
    }
  }

  const startForward = async (form: TunnelForm): Promise<boolean> => {
    if (!sessionId) return false
    try {
      await api.post(`/tunnels/${sessionId}/start`, form)
      setActiveForwards((current) => [...current, { ...form, id: Date.now() }])
      return true
    } catch (err) {
      const data = (
        err as { response?: { data?: { code?: string; port?: number; error?: string } } }
      )?.response?.data
      // BL-31: name the busy port instead of a generic failure
      toast.error(
        data?.code === 'PORT_IN_USE'
          ? `Port ${data.port} is already in use. Choose another local port.`
          : (data?.error ?? 'Failed to start tunnel')
      )
      return false
    }
  }

  const handleStartTunnel = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (await startForward(tunnelForm)) {
      setTunnelForm({ type: 'local', localPort: '', remoteHost: '127.0.0.1', remotePort: '' })
    }
  }

  const handleStopTunnel = async (forward: ActiveForward): Promise<void> => {
    if (!sessionId) return
    try {
      // §9.8 / BL-23: the local port for local and dynamic forwards, the remote port for remote
      await api.post(`/tunnels/${sessionId}/stop`, {
        type: forward.type,
        port: forward.type === 'remote' ? forward.remotePort : forward.localPort
      })
      setActiveForwards(activeForwards.filter((f) => f.id !== forward.id))
    } catch {
      toast.error('Failed to stop tunnel')
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f] h-full text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f] h-full text-red-500">
        Profile not found.
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0a0f] overflow-auto">
      <HostKeyDialog
        info={hostKey}
        onTrust={() => hostKey && handleConnect(hostKey.fingerprint)}
        onClose={() => setHostKey(null)}
      />
      {/* Header and Connection Status */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between p-8 border-b border-slate-800/60 bg-gradient-to-b from-[#151821] to-[#0a0a0f]">
        <div className="flex items-center gap-5">
          <div
            className={cn(
              'w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg transition-colors duration-500',
              status === 'connected'
                ? 'bg-emerald-500/10 shadow-emerald-500/10'
                : 'bg-slate-800 shadow-slate-900'
            )}
          >
            <Server
              className={cn(
                'w-8 h-8 transition-colors duration-500',
                status === 'connected' ? 'text-emerald-500' : 'text-slate-400'
              )}
            />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-100 tracking-tight">{profile.name}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                {profile.username}@{profile.host}:{profile.port}
              </span>
              <span
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors duration-300',
                  status === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                    : status === 'connecting' || status === 'disconnecting'
                      ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                )}
              >
                {status === 'connected' && <Wifi className="w-3.5 h-3.5" />}
                {(status === 'connecting' || status === 'disconnecting') && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                {status === 'disconnected' && <Power className="w-3.5 h-3.5" />}
                {status === 'connected' && reconnecting
                  ? 'Reconnecting…'
                  : status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 md:mt-0 flex items-center gap-3">
          <button
            onClick={() => setEditOpen(true)}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium flex items-center gap-2 transition-colors border border-slate-700"
          >
            <Pencil className="w-4 h-4" />
            Edit Profile
          </button>
          {status === 'disconnected' && (
            <button
              onClick={() => handleConnect()}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-2 transition-colors shadow-lg shadow-emerald-500/20"
            >
              <Power className="w-4 h-4" />
              Connect Host
            </button>
          )}
          {status === 'connected' && (
            <button
              onClick={handleDisconnect}
              className="px-6 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 font-medium flex items-center gap-2 transition-colors border border-red-500/20"
            >
              <Power className="w-4 h-4" />
              Disconnect
            </button>
          )}
          {(status === 'connecting' || status === 'disconnecting') && (
            <button
              disabled
              className="px-6 py-2.5 rounded-xl bg-slate-800 text-slate-400 font-medium flex items-center gap-2 opacity-70 cursor-not-allowed"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              {status === 'connecting' ? 'Connecting...' : 'Disconnecting...'}
            </button>
          )}
        </div>
      </div>

      {localStatus === 'connected' && sessionEnded && (
        <div className="mx-8 mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          The SSH session has ended. Connect again to continue.
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 p-8 grid md:grid-cols-2 gap-6 max-w-6xl w-full mx-auto">
        {/* Action Cards */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Remote Operations
          </h2>

          <button
            onClick={handleOpenTerminal}
            disabled={status !== 'connected'}
            title={status !== 'connected' ? 'Connect to the host first' : 'Open Terminal'}
            className={cn(
              'w-full flex items-center gap-5 p-6 rounded-2xl border transition-all duration-300 text-left group',
              status === 'connected'
                ? 'bg-[#151821] border-slate-700 hover:border-emerald-500/50 hover:bg-[#1a1c23] hover:shadow-lg'
                : 'bg-[#0f1117] border-slate-800/50 opacity-50 cursor-not-allowed'
            )}
          >
            <div
              className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center transition-colors duration-300',
                status === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500/20'
                  : 'bg-slate-800 text-slate-500'
              )}
            >
              <TerminalSquare className="w-6 h-6" />
            </div>
            <div>
              <h3
                className={cn(
                  'text-lg font-semibold',
                  status === 'connected'
                    ? 'text-slate-200 group-hover:text-emerald-400'
                    : 'text-slate-500'
                )}
              >
                Terminal Console
              </h3>
              <p className="text-slate-500 text-sm mt-0.5">
                Spawn a standalone interactive shell window
              </p>
            </div>
          </button>

          <button
            onClick={handleOpenSftp}
            disabled={status !== 'connected'}
            title={status !== 'connected' ? 'Connect to the host first' : 'Open SFTP'}
            className={cn(
              'w-full flex items-center gap-5 p-6 rounded-2xl border transition-all duration-300 text-left group',
              status === 'connected'
                ? 'bg-[#151821] border-slate-700 hover:border-blue-500/50 hover:bg-[#1a1c23] hover:shadow-lg'
                : 'bg-[#0f1117] border-slate-800/50 opacity-50 cursor-not-allowed'
            )}
          >
            <div
              className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center transition-colors duration-300',
                status === 'connected'
                  ? 'bg-blue-500/10 text-blue-500 group-hover:bg-blue-500/20'
                  : 'bg-slate-800 text-slate-500'
              )}
            >
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <h3
                className={cn(
                  'text-lg font-semibold',
                  status === 'connected'
                    ? 'text-slate-200 group-hover:text-blue-400'
                    : 'text-slate-500'
                )}
              >
                SFTP Explorer
              </h3>
              <p className="text-slate-500 text-sm mt-0.5">Open a visual file transfer manager</p>
            </div>
          </button>
        </div>

        {/* Profile Info & Port Forwarding */}
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
              Configuration Details
            </h2>
            <div className="bg-[#151821] border border-slate-800 rounded-2xl p-6 space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center">
                  <Box className="w-5 h-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Hostname / IP</p>
                  <p className="font-medium text-slate-200 font-mono">{profile.host}</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Authentication Method</p>
                  <p className="font-medium text-slate-200">
                    {profile.authMethod === 'password' ? 'Password Based' : 'SSH Key Pair'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Port Forwarding / Tunnels Card (Only active when connected) */}
          {status === 'connected' && (
            <div>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
                Port Forwarding (Tunnels)
              </h2>
              <div className="bg-[#151821] border border-slate-800 rounded-2xl p-6 space-y-6">
                {/* Form to add forward */}
                <form onSubmit={handleStartTunnel} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                        Type
                      </label>
                      <select
                        value={tunnelForm.type}
                        onChange={(e) =>
                          setTunnelForm({ ...tunnelForm, type: e.target.value as TunnelType })
                        }
                        className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                      >
                        <option value="local">Local (L)</option>
                        <option value="remote">Remote (R)</option>
                        <option value="dynamic">Dynamic (SOCKS5)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                        Local Port
                      </label>
                      <input
                        required
                        type="number"
                        value={tunnelForm.localPort}
                        onChange={(e) =>
                          setTunnelForm({ ...tunnelForm, localPort: e.target.value })
                        }
                        className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500 transition-colors font-mono"
                        placeholder="e.g. 8080"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                        Remote Host
                      </label>
                      <input
                        required
                        type="text"
                        value={tunnelForm.remoteHost}
                        onChange={(e) =>
                          setTunnelForm({ ...tunnelForm, remoteHost: e.target.value })
                        }
                        className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500 transition-colors font-mono disabled:opacity-40"
                        placeholder={tunnelForm.type === 'dynamic' ? 'N/A' : '127.0.0.1'}
                        disabled={tunnelForm.type === 'remote' || tunnelForm.type === 'dynamic'}
                      />
                    </div>
                    <div className="pt-6 px-1 text-slate-600">
                      <ArrowRightLeft className="w-4 h-4" />
                    </div>
                    <div className="w-28">
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                        Remote Port
                      </label>
                      <input
                        required={tunnelForm.type !== 'dynamic'}
                        type="number"
                        value={tunnelForm.remotePort}
                        onChange={(e) =>
                          setTunnelForm({ ...tunnelForm, remotePort: e.target.value })
                        }
                        className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-40"
                        placeholder={tunnelForm.type === 'dynamic' ? 'N/A' : '80'}
                        disabled={tunnelForm.type === 'dynamic'}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors text-sm shadow-lg shadow-emerald-500/10"
                    >
                      <Play className="w-3.5 h-3.5" /> Start Forwarding
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveRule}
                      className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors text-sm border border-slate-700"
                    >
                      <Save className="w-3.5 h-3.5" /> Save rule
                    </button>
                  </div>
                </form>

                {/* Saved rules (BL-34) */}
                <div className="border-t border-slate-800/80 pt-4">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Saved Rules
                  </h3>
                  {savedRules.length === 0 ? (
                    <div className="text-xs text-slate-500 italic text-center py-4 bg-[#0a0a0f]/50 rounded-xl border border-slate-800/60 border-dashed">
                      No saved rules
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {savedRules.map((rule) => (
                        <div
                          key={rule.id}
                          className="flex items-center justify-between bg-[#0a0a0f]/40 border border-slate-800/80 rounded-xl p-3"
                        >
                          <span className="text-slate-300 text-xs font-mono">
                            {describeRule(rule)}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => startForward(ruleToForm(rule))}
                              className="text-emerald-400 hover:text-emerald-300 p-1.5 hover:bg-emerald-500/10 rounded-lg transition-colors"
                              title="Start saved rule"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteRule(rule)}
                              className="text-red-400 hover:text-red-300 p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Delete saved rule"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* List of active forwards */}
                <div className="border-t border-slate-800/80 pt-4">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Active Forwards
                  </h3>
                  {activeForwards.length === 0 ? (
                    <div className="text-xs text-slate-500 italic text-center py-4 bg-[#0a0a0f]/50 rounded-xl border border-slate-800/60 border-dashed">
                      No active port forwards
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {activeForwards.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between bg-[#0a0a0f]/40 border border-slate-800/80 rounded-xl p-3"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider',
                                f.type === 'local'
                                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                  : f.type === 'dynamic'
                                    ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20'
                                    : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                              )}
                            >
                              {f.type === 'local'
                                ? 'LOCAL'
                                : f.type === 'dynamic'
                                  ? 'SOCKS5'
                                  : 'REMOTE'}
                            </span>
                            <span className="text-slate-300 text-xs font-mono">
                              {f.type === 'dynamic'
                                ? `SOCKS5 Proxy on :${f.localPort}`
                                : `${f.localPort} ↔ ${f.remoteHost}:${f.remotePort}`}
                            </span>
                          </div>
                          <button
                            onClick={() => handleStopTunnel(f)}
                            className="text-red-400 hover:text-red-300 p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Stop Tunnel"
                          >
                            <Square className="w-3.5 h-3.5" fill="currentColor" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ProfileForm key={profile.id} profile={profile} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  )
}
