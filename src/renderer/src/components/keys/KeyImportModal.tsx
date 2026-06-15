import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { UploadCloud, X, Save, FileText } from 'lucide-react'

interface KeyImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ImportKeyData {
  name: string
  description: string
  privateKey: string
  passphrase: string
}

export function KeyImportModal({
  open,
  onOpenChange
}: KeyImportModalProps): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<ImportKeyData>({
    name: '',
    description: '',
    privateKey: '',
    passphrase: ''
  })

  const mutation = useMutation({
    mutationFn: async (data: ImportKeyData) => {
      return api.post('/keys/import', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      onOpenChange(false)
      setFormData({ name: '', description: '', privateKey: '', passphrase: '' })
    }
  })

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    mutation.mutate(formData)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setFormData({ ...formData, privateKey: ev.target?.result as string })
      }
      reader.readAsText(file)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#0f1117] border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-emerald-500/10 flex items-center justify-center">
              <UploadCloud className="w-4 h-4 text-emerald-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-200">Import SSH Key</h2>
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
              placeholder="e.g. AWS Production Key"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Private Key (PEM format)
            </label>
            <div className="relative">
              <textarea
                required
                rows={4}
                value={formData.privateKey}
                onChange={(e) => setFormData({ ...formData, privateKey: e.target.value })}
                className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors font-mono text-xs"
                placeholder="-----BEGIN PRIVATE KEY-----..."
              />
              <label className="absolute bottom-2 right-2 cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs py-1 px-2 rounded transition-colors flex items-center gap-1">
                <FileText className="w-3 h-3" /> Browse File
                <input type="file" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Passphrase (If encrypted)
            </label>
            <input
              type="password"
              value={formData.passphrase}
              onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
              className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="Leave blank if not encrypted"
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
            />
          </div>

          {mutation.error && (
            <div className="text-red-500 text-sm mt-2">
              Failed to import key. {(mutation.error as Error).message}
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
              disabled={mutation.isPending || !formData.privateKey}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              <Save className="w-4 h-4" />
              {mutation.isPending ? 'Importing...' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
