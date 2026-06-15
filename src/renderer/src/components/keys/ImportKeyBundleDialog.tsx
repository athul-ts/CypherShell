import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { PackageOpen, X, AlertTriangle } from 'lucide-react'

type Resolution = 'skip' | 'rename' | 'overwrite'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ImportBundleResponse {
  status?: string
  conflictName?: string
  profileCount?: number
}

interface ApiError {
  response?: {
    status?: number
    data?: { status?: string; conflictName?: string; profileCount?: number; error?: string }
  }
}

type LocalFileOpApi = {
  executeLocalFileOp: (op: string, args: { path: string }) => Promise<string>
}

export function ImportKeyBundleDialog({ open, onOpenChange }: Props): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const [bundle, setBundle] = useState<object | null>(null)
  const [bundleFileName, setBundleFileName] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [conflict, setConflict] = useState<string | null>(null)
  const [conflictProfileCount, setConflictProfileCount] = useState(0)
  const [resolution, setResolution] = useState<Resolution>('skip')
  const [error, setError] = useState('')

  const reset = (): void => {
    setBundle(null)
    setBundleFileName('')
    setPassphrase('')
    setConflict(null)
    setConflictProfileCount(0)
    setError('')
  }

  const handleClose = (): void => {
    reset()
    onOpenChange(false)
  }

  const handlePickFile = async (): Promise<void> => {
    const paths = await window.api.openCskbFileDialog()
    if (!paths || paths.length === 0) return
    try {
      const localApi = (window as unknown as { api: LocalFileOpApi }).api
      const content = await localApi.executeLocalFileOp('readFile', { path: paths[0] })
      setBundle(JSON.parse(content))
      setBundleFileName(paths[0].split(/[\\/]/).pop() ?? paths[0])
      setError('')
    } catch {
      setError('Failed to read or parse the selected file. Make sure it is a valid .cskb bundle.')
    }
  }

  const doImport = useMutation({
    mutationFn: async (res: Resolution | null) => {
      return api.post('/keys/import-bundle', {
        bundle,
        passphrase,
        resolution: res
      })
    },
    onSuccess: ({ data }: { data: ImportBundleResponse }) => {
      if (data.status === 'conflict') {
        setConflict(data.conflictName ?? null)
        setConflictProfileCount(data.profileCount ?? 0)
        return
      }
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      handleClose()
    },
    onError: (err: ApiError) => {
      if (err?.response?.status === 409 && err?.response?.data?.status === 'conflict') {
        setConflict(err.response.data.conflictName ?? null)
        setConflictProfileCount(err.response.data.profileCount ?? 0)
        return
      }
      setError(err?.response?.data?.error ?? 'Import failed')
    }
  })

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    setError('')
    doImport.mutate(null)
  }

  const handleResolve = (): void => {
    setConflict(null)
    doImport.mutate(resolution)
  }

  if (!open) return null

  if (conflict) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-[#0f1117] border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              </div>
              <h2 className="text-base font-semibold text-slate-200">Import Conflict</h2>
            </div>
            <button onClick={handleClose} className="text-slate-500 hover:text-slate-300">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-400">
              A key named{' '}
              <span className="font-semibold text-slate-200">&quot;{conflict}&quot;</span> already
              exists. Choose how to proceed:
            </p>
            <div className="flex gap-2">
              {(['skip', 'rename', 'overwrite'] as Resolution[]).map((action) => (
                <button
                  key={action}
                  onClick={() => setResolution(action)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    resolution === action
                      ? action === 'overwrite'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/50'
                        : action === 'rename'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                          : 'bg-slate-700 text-slate-200 border border-slate-600'
                      : 'bg-slate-800 text-slate-500 border border-transparent hover:text-slate-300'
                  }`}
                >
                  {action === 'rename' ? 'Rename (copy)' : action}
                </button>
              ))}
            </div>
            {resolution === 'overwrite' && (
              <p className="text-xs text-red-400">
                The existing key will be permanently deleted.
                {conflictProfileCount > 0 &&
                  ` ${conflictProfileCount} profile${conflictProfileCount === 1 ? '' : 's'} using it will lose their key assignment.`}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-800 mt-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={doImport.isPending}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {doImport.isPending ? 'Importing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#0f1117] border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-emerald-500/10 flex items-center justify-center">
              <PackageOpen className="w-4 h-4 text-emerald-500" />
            </div>
            <h2 className="text-base font-semibold text-slate-200">Import Key Bundle</h2>
          </div>
          <button onClick={handleClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Bundle File (.cskb)
            </label>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-sm text-slate-400 truncate">
                {bundleFileName || 'No file selected'}
              </div>
              <button
                type="button"
                onClick={handlePickFile}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
              >
                Browse…
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Export Passphrase
            </label>
            <input
              required
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="Passphrase used when the bundle was exported"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800 mt-4">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={doImport.isPending || !bundle || !passphrase}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              <PackageOpen className="w-4 h-4" />
              {doImport.isPending ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
