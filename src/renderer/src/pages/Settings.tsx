import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import {
  Settings as SettingsIcon,
  Save,
  Monitor,
  Clock,
  FileText,
  Lock,
  Terminal
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTerminalThemeStore } from '../store/terminalThemeStore'
import { TERMINAL_THEMES, THEME_LABELS } from '../lib/terminalThemes'

interface AppConfig {
  theme: string
  defaultFont: string
  defaultFontSize: number
  logRetentionDays: number
  lockEnabled: boolean
  autoLockMinutes: number
}

export default function Settings(): React.JSX.Element {
  const queryClient = useQueryClient()

  const { data: config, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: async (): Promise<AppConfig> => {
      const res = await api.get<AppConfig>('/config')
      return res.data
    }
  })

  const [formData, setFormData] = useState({
    theme: 'dark',
    defaultFont: 'JetBrains Mono',
    defaultFontSize: 14,
    logRetentionDays: 90,
    lockEnabled: false,
    autoLockMinutes: 15
  })

  useEffect(() => {
    if (config) {
      // Safe one-time sync of the editable form from server-fetched config; the
      // `config` reference only changes when the query data changes, so this does
      // not cascade on every render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        theme: config.theme,
        defaultFont: config.defaultFont,
        defaultFontSize: config.defaultFontSize,
        logRetentionDays: config.logRetentionDays,
        lockEnabled: config.lockEnabled,
        autoLockMinutes: config.autoLockMinutes
      })
    }
  }, [config])

  const mutation = useMutation({
    mutationFn: async (data: AppConfig) => {
      return api.put('/config', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      alert('Settings saved successfully!')
    },
    onError: () => {
      alert('Failed to save settings')
    }
  })

  const terminalThemeStore = useTerminalThemeStore()

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    mutation.mutate(formData)
  }

  if (isLoading) {
    return <div className="p-8 text-slate-500">Loading settings...</div>
  }

  return (
    <div className="flex-1 p-8 bg-[#0a0a0f] h-full overflow-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <SettingsIcon className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-200">Settings</h1>
          <p className="text-slate-500 mt-1">Configure global application preferences.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
        {/* Appearance */}
        <div className="bg-[#151821] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-slate-400" />
            <h2 className="font-semibold text-slate-200">App Appearance</h2>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">App Theme</label>
              <select
                value={formData.theme}
                onChange={(e) => setFormData({ ...formData, theme: e.target.value })}
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="dark">Dark Theme (Default)</option>
                <option value="light">Light Theme (Preview)</option>
                <option value="system">System Preference</option>
              </select>
            </div>
          </div>
        </div>

        {/* Terminal Appearance */}
        <div className="bg-[#151821] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-slate-400" />
            <h2 className="font-semibold text-slate-200">Terminal</h2>
          </div>
          <div className="p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Color Theme</label>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(THEME_LABELS).map(([key, label]) => {
                  const colors = TERMINAL_THEMES[key]
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => terminalThemeStore.setTheme(key)}
                      className={`relative p-3 rounded-lg border-2 text-left transition-all ${
                        terminalThemeStore.theme === key
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      <div
                        className="w-full h-10 rounded mb-2 flex items-end gap-1 px-2 pb-1.5"
                        style={{ backgroundColor: colors.background }}
                      >
                        {[colors.green, colors.blue, colors.red, colors.yellow].map((c, i) => (
                          <div
                            key={i}
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <span className="text-xs font-medium text-slate-300">{label}</span>
                      {terminalThemeStore.theme === key && (
                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">
                  Font Size (px)
                </label>
                <input
                  type="number"
                  min="10"
                  max="32"
                  value={terminalThemeStore.fontSize}
                  onChange={(e) => terminalThemeStore.setFontSize(parseInt(e.target.value))}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Font Family</label>
                <select
                  value={terminalThemeStore.fontFamily}
                  onChange={(e) => terminalThemeStore.setFontFamily(e.target.value)}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="JetBrains Mono, Consolas, monospace">JetBrains Mono</option>
                  <option value="Consolas, monospace">Consolas</option>
                  <option value="'Fira Code', monospace">Fira Code</option>
                  <option value="'Cascadia Code', monospace">Cascadia Code</option>
                  <option value="'Source Code Pro', monospace">Source Code Pro</option>
                  <option value="monospace">System Monospace</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Theme and font changes apply to new terminal sessions.
            </p>
          </div>
        </div>

        {/* Security */}
        <div className="bg-[#151821] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-400" />
            <h2 className="font-semibold text-slate-200">Security</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between p-4 bg-[#1a1c23] rounded-lg border border-slate-800">
              <div>
                <div className="font-medium text-slate-200">App Lock</div>
                <div className="text-sm text-slate-500 mt-1">
                  Require master password when opening the app
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={formData.lockEnabled}
                  onChange={(e) => setFormData({ ...formData, lockEnabled: e.target.checked })}
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {formData.lockEnabled && (
              <div className="grid grid-cols-2 gap-6 pt-2">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">
                    Auto-Lock Time (Minutes)
                  </label>
                  <div className="relative">
                    <Clock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={formData.autoLockMinutes}
                      onChange={(e) =>
                        setFormData({ ...formData, autoLockMinutes: parseInt(e.target.value) })
                      }
                      className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Data Management */}
        <div className="bg-[#151821] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" />
            <h2 className="font-semibold text-slate-200">Data Management</h2>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">
                Audit Log Retention (Days)
              </label>
              <select
                value={formData.logRetentionDays}
                onChange={(e) =>
                  setFormData({ ...formData, logRetentionDays: parseInt(e.target.value) })
                }
                className="w-full max-w-xs bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value={7}>7 Days</option>
                <option value={30}>30 Days</option>
                <option value={90}>90 Days</option>
                <option value={365}>1 Year</option>
              </select>
              <p className="text-xs text-slate-500 mt-2">
                Logs older than the selected duration will be automatically deleted.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-8">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 transition-colors"
          >
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
