import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { Key, X, Save } from 'lucide-react'

interface KeyGeneratorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface GenerateKeyData {
  name: string
  description: string
  type: string
  passphrase: string
}

export function KeyGeneratorModal({
  open,
  onOpenChange
}: KeyGeneratorModalProps): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<GenerateKeyData>({
    name: '',
    description: '',
    type: 'ed25519',
    passphrase: ''
  })

  const mutation = useMutation({
    mutationFn: async (data: GenerateKeyData) => {
      return api.post('/keys/generate', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      onOpenChange(false)
      setFormData({ name: '', description: '', type: 'ed25519', passphrase: '' })
    }
  })

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    mutation.mutate(formData)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#0f1117] border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-emerald-500/10 flex items-center justify-center">
              <Key className="w-4 h-4 text-emerald-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-200">Generate SSH Key</h2>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-slate-500 hover:text-slate-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Key Name</label>
            <input
              required
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="e.g. My Personal Laptop"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Algorithm</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
            >
              <option value="ed25519">ED25519 (Recommended)</option>
              <option value="rsa">RSA (2048-bit)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Passphrase (Optional)
            </label>
            <input
              type="password"
              value={formData.passphrase}
              onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
              className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="Leave blank for no passphrase"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Description (Optional)
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="Used for connecting to production"
            />
          </div>

          {mutation.error && (
            <div className="text-red-500 text-sm mt-2">
              Failed to generate key. {(mutation.error as Error).message}
            </div>
          )}

          <div className="mt-8 flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
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
              {mutation.isPending ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
