import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { Server, Save, X } from 'lucide-react'

export type AuthMethod = 'password' | 'key' | 'key+passphrase'

interface Profile {
  id: string
  name: string
  group?: string | null
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  sshKeyId?: string | null
  hasPassword?: boolean
}

interface SshKeySummary {
  id: string
  name: string
  keyType: string
}

interface ProfilePayload {
  name: string
  group: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  password: string
  sshKeyId: string | undefined
}

interface ProfileFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile?: Profile
}

export function ProfileForm({
  open,
  onOpenChange,
  profile
}: ProfileFormProps): React.JSX.Element | null {
  const queryClient = useQueryClient()

  const { data: keys } = useQuery<SshKeySummary[]>({
    queryKey: ['keys'],
    queryFn: async () => {
      const res = await api.get('/keys')
      return res.data
    }
  })

  const [formData, setFormData] = useState({
    name: profile?.name || '',
    group: profile?.group || '',
    host: profile?.host || '',
    port: profile?.port || 22,
    username: profile?.username || '',
    authMethod: profile?.authMethod || 'password',
    password: '',
    sshKeyId: profile?.sshKeyId || ''
  })

  const mutation = useMutation({
    mutationFn: async (data: ProfilePayload) => {
      if (profile) {
        return api.put(`/profiles/${profile.id}`, data)
      }
      return api.post('/profiles', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
      if (profile?.id) {
        queryClient.invalidateQueries({ queryKey: ['profile', profile.id] })
      }
      onOpenChange(false)
    }
  })

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const submitData = {
      ...formData,
      sshKeyId:
        formData.authMethod === 'password' || !formData.sshKeyId ? undefined : formData.sshKeyId
    }
    mutation.mutate(submitData)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#0f1117] border border-slate-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-emerald-500/10 flex items-center justify-center">
              <Server className="w-4 h-4 text-emerald-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-200">
              {profile ? 'Edit Profile' : 'New Profile'}
            </h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-slate-500 hover:text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
              <input
                required
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="e.g. Production Web Server"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Group Tag</label>
              <input
                type="text"
                value={formData.group}
                onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="e.g. Production, Staging, Personal"
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-400 mb-1">Host</label>
                <input
                  required
                  type="text"
                  value={formData.host}
                  onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="192.168.1.10"
                />
              </div>
              <div className="w-24">
                <label className="block text-sm font-medium text-slate-400 mb-1">Port</label>
                <input
                  required
                  type="number"
                  value={formData.port}
                  onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Username</label>
              <input
                required
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="root"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Auth Method</label>
              <select
                value={formData.authMethod}
                onChange={(e) =>
                  setFormData({ ...formData, authMethod: e.target.value as AuthMethod })
                }
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              >
                <option value="password">Password</option>
                <option value="key">SSH Key</option>
              </select>
            </div>

            {formData.authMethod === 'password' ? (
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Password</label>
                <input
                  required={!profile && formData.authMethod === 'password'}
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder={
                    profile?.hasPassword
                      ? '•••••••• (Leave blank to keep existing)'
                      : 'Secret password'
                  }
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">
                  Select SSH Key
                </label>
                <select
                  required
                  value={formData.sshKeyId || ''}
                  onChange={(e) => setFormData({ ...formData, sshKeyId: e.target.value })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                >
                  <option value="">Select a key...</option>
                  {keys?.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.keyType})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {mutation.error && (
              <div className="text-red-500 text-sm mt-2">
                Failed to save profile. Please check the inputs.
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              <Save className="w-4 h-4" />
              {mutation.isPending ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
