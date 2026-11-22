import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { Server, Save, X } from 'lucide-react'
import {
  buildProfilePayload,
  validateProfile,
  type ProfileField,
  type AuthMethod,
  type ProfileFormValues,
  type ProfilePayload,
  type ProfileSnapshot
} from './profilePayload'

interface Profile extends ProfileSnapshot {
  id: string
}

interface SshKeySummary {
  id: string
  name: string
  keyType: string
}

interface ProfileFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile?: Profile
}

function initialValues(profile?: Profile): ProfileFormValues {
  return {
    name: profile?.name || '',
    group: profile?.group || '',
    host: profile?.host || '',
    port: profile?.port || 22,
    username: profile?.username || '',
    authMethod: profile?.authMethod || 'password',
    password: '',
    sshKeyId: profile?.sshKeyId || '',
    autoReconnect: profile?.autoReconnect ?? true
  }
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

  const [formData, setFormData] = useState<ProfileFormValues>(() => initialValues(profile))
  // FR-01.8.7: field errors, shown after the first submit and cleared as each field is edited
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({})
  const change = (patch: Partial<ProfileFormValues>): void => {
    setFormData((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof ProfileFormValues)[]) delete next[key]
      return next
    })
  }

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
      // Clear the typed secret so a reopened form never resubmits it.
      setFormData((current) => ({ ...current, password: '' }))
      onOpenChange(false)
    }
  })

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const found = validateProfile(profile, formData)
    setErrors(found)
    if (Object.keys(found).length > 0) return // nothing is sent until the form is valid
    // FR-01.8.4: on edit, send only the changed fields — never an empty password.
    const payload = buildProfilePayload(profile, formData)
    if (profile && Object.keys(payload).length === 0) {
      onOpenChange(false)
      return
    }
    mutation.mutate(payload)
  }

  const handleCancel = (): void => {
    setFormData(initialValues(profile))
    setErrors({})
    mutation.reset()
    onOpenChange(false)
  }

  if (!open) return null

  const fieldError = (key: ProfileField): React.JSX.Element | null =>
    errors[key] ? (
      <p role="alert" className="mt-1 text-xs text-red-400">
        {errors[key]}
      </p>
    ) : null

  const usesKey = formData.authMethod !== 'password'
  const needsSecret = formData.authMethod !== 'key'
  const keepsStoredSecret =
    !!profile?.hasPassword && profile.authMethod === formData.authMethod && needsSecret
  const secretLabel = formData.authMethod === 'password' ? 'Password' : 'Key Passphrase'

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
            type="button"
            onClick={handleCancel}
            aria-label="Close"
            className="text-slate-500 hover:text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-6">
          <div className="space-y-4">
            <div>
              <label
                htmlFor="profile-name"
                className="block text-sm font-medium text-slate-400 mb-1"
              >
                Name
              </label>
              <input
                id="profile-name"
                aria-invalid={!!errors.name}
                type="text"
                value={formData.name}
                onChange={(e) => change({ name: e.target.value })}
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="e.g. Production Web Server"
              />
              {fieldError('name')}
            </div>

            <div>
              <label
                htmlFor="profile-group"
                className="block text-sm font-medium text-slate-400 mb-1"
              >
                Group Tag
              </label>
              <input
                id="profile-group"
                type="text"
                value={formData.group}
                onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="e.g. Production, Staging, Personal"
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label
                  htmlFor="profile-host"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Host
                </label>
                <input
                  id="profile-host"
                  aria-invalid={!!errors.host}
                  type="text"
                  value={formData.host}
                  onChange={(e) => change({ host: e.target.value })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="192.168.1.10"
                />
                {fieldError('host')}
              </div>
              <div className="w-24">
                <label
                  htmlFor="profile-port"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Port
                </label>
                <input
                  id="profile-port"
                  aria-invalid={!!errors.port}
                  type="number"
                  min={1}
                  max={65535}
                  value={Number.isNaN(formData.port) ? '' : formData.port}
                  onChange={(e) => change({ port: parseInt(e.target.value) })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                />
                {fieldError('port')}
              </div>
            </div>

            <div>
              <label
                htmlFor="profile-username"
                className="block text-sm font-medium text-slate-400 mb-1"
              >
                Username
              </label>
              <input
                id="profile-username"
                aria-invalid={!!errors.username}
                type="text"
                value={formData.username}
                onChange={(e) => change({ username: e.target.value })}
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="root"
              />
              {fieldError('username')}
            </div>

            <div>
              <label
                htmlFor="profile-auth-method"
                className="block text-sm font-medium text-slate-400 mb-1"
              >
                Auth Method
              </label>
              <select
                id="profile-auth-method"
                value={formData.authMethod}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    authMethod: e.target.value as AuthMethod,
                    // A secret typed for the previous method must not carry over.
                    password: ''
                  })
                }
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              >
                <option value="password">Password</option>
                <option value="key">SSH Key</option>
                <option value="key+passphrase">SSH Key + Passphrase</option>
              </select>
            </div>

            {usesKey && (
              <div>
                <label
                  htmlFor="profile-ssh-key"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  Select SSH Key
                </label>
                <select
                  id="profile-ssh-key"
                  aria-invalid={!!errors.sshKeyId}
                  value={formData.sshKeyId || ''}
                  onChange={(e) => change({ sshKeyId: e.target.value })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                >
                  <option value="">Select a key...</option>
                  {keys?.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.keyType})
                    </option>
                  ))}
                </select>
                {fieldError('sshKeyId')}
              </div>
            )}

            {needsSecret && (
              <div>
                <label
                  htmlFor="profile-secret"
                  className="block text-sm font-medium text-slate-400 mb-1"
                >
                  {secretLabel}
                </label>
                <input
                  id="profile-secret"
                  aria-invalid={!!errors.password}
                  type="password"
                  value={formData.password}
                  onChange={(e) => change({ password: e.target.value })}
                  className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder={
                    keepsStoredSecret
                      ? '•••••••• (Leave blank to keep existing)'
                      : formData.authMethod === 'password'
                        ? 'Secret password'
                        : 'Passphrase for the selected key'
                  }
                />
                {fieldError('password')}
              </div>
            )}

            <label
              htmlFor="profile-auto-reconnect"
              className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer"
            >
              <input
                id="profile-auto-reconnect"
                type="checkbox"
                checked={formData.autoReconnect}
                onChange={(e) => change({ autoReconnect: e.target.checked })}
              />
              Reconnect automatically
            </label>

            {mutation.error && (
              <div className="text-red-500 text-sm mt-2">
                Failed to save profile. Please check the inputs.
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleCancel}
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
