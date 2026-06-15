import { useState } from 'react'
import { api } from '../../lib/api'
import { PackageOpen, X, Lock } from 'lucide-react'

interface Props {
  open: boolean
  keyId: string
  keyName: string
  onOpenChange: (open: boolean) => void
}

interface ApiErrorResponse {
  message?: string
  response?: { data?: { error?: string } }
}

type LocalFileOpApi = {
  saveFileDialog: (defaultName: string) => Promise<string | null>
  executeLocalFileOp: (op: string, args: { path: string; content: string }) => Promise<void>
}

export function ExportKeyBundleDialog({
  open,
  keyId,
  keyName,
  onOpenChange
}: Props): React.JSX.Element | null {
  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const reset = (): void => {
    setPassphrase('')
    setConfirmPassphrase('')
    setError('')
  }

  const handleClose = (): void => {
    reset()
    onOpenChange(false)
  }

  const handleExport = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data: bundle } = await api.post(`/keys/${keyId}/export-bundle`, {
        passphrase,
        confirmPassphrase
      })
      const defaultName = `${keyName.replace(/[^a-zA-Z0-9_-]/g, '_')}.cskb`
      const localApi = (window as unknown as { api: LocalFileOpApi }).api
      const savePath = await localApi.saveFileDialog(defaultName)
      if (!savePath) return
      await localApi.executeLocalFileOp('writeFile', {
        path: savePath,
        content: JSON.stringify(bundle, null, 2)
      })
      handleClose()
    } catch (err) {
      const error = err as ApiErrorResponse
      setError(error?.response?.data?.error ?? error?.message ?? 'Export failed')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#0f1117] border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-emerald-500/10 flex items-center justify-center">
              <PackageOpen className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-200">Export Key Bundle</h2>
              <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[240px]">{keyName}</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleExport} className="p-6 space-y-4">
          <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
            <Lock className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-300 leading-relaxed">
              The private key will be encrypted with your passphrase before being written to disk.
              Keep this passphrase safe — it is required to import the bundle.
            </p>
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
              placeholder="Choose a strong passphrase"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Confirm Passphrase
            </label>
            <input
              required
              type="password"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              className="w-full bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="Re-enter passphrase"
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
              disabled={loading || !passphrase}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              <PackageOpen className="w-4 h-4" />
              {loading ? 'Exporting…' : 'Export .cskb'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
