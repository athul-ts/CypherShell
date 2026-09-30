import { toast } from 'sonner'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Key, Plus, Upload, Trash2, Copy, Download, PackageOpen } from 'lucide-react'
import { KeyGeneratorModal } from '../components/keys/KeyGeneratorModal'
import { KeyImportModal } from '../components/keys/KeyImportModal'
import { ExportKeyBundleDialog } from '../components/keys/ExportKeyBundleDialog'
import { ImportKeyBundleDialog } from '../components/keys/ImportKeyBundleDialog'
import { format } from 'date-fns'

interface SshKey {
  id: string
  name: string
  description?: string | null
  keyType: string
  fingerprint: string
  publicKey: string
  createdAt: string
}

interface KeyUsageResponse {
  profiles: { id: string; name: string }[]
}

interface ApiErrorResponse {
  response?: { data?: { error?: string } }
}

type LocalFileOpApi = {
  saveFileDialog: (defaultName: string) => Promise<string | null>
  executeLocalFileOp: (op: string, args: { path: string; content: string }) => Promise<void>
}

export default function Keys(): React.JSX.Element {
  const [generateOpen, setGenerateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importBundleOpen, setImportBundleOpen] = useState(false)
  const [exportBundle, setExportBundle] = useState<{ id: string; name: string } | null>(null)

  const {
    data: keys,
    isLoading,
    refetch
  } = useQuery({
    queryKey: ['keys'],
    queryFn: async () => {
      const res = await api.get<SshKey[]>('/keys')
      return res.data
    }
  })

  const handleDelete = async (id: string): Promise<void> => {
    try {
      const { data } = await api.get<KeyUsageResponse>(`/keys/${id}/usage`)
      const profiles = data.profiles
      let message = 'Are you sure you want to delete this key? It cannot be recovered.'
      if (profiles.length > 0) {
        const names = profiles.map((p) => `• ${p.name}`).join('\n')
        message = `This key is used by ${profiles.length} profile(s):\n${names}\n\nDeleting it will remove the key assignment from those profiles. Continue?`
      }
      if (!confirm(message)) return
      await api.delete(`/keys/${id}`)
      refetch()
    } catch (err) {
      const error = err as ApiErrorResponse
      toast.error(error?.response?.data?.error ?? 'Failed to delete key')
    }
  }

  const copyToClipboard = (text: string): void => {
    navigator.clipboard.writeText(text)
  }

  const handleExport = async (key: SshKey): Promise<void> => {
    const localApi = (window as unknown as { api: LocalFileOpApi }).api
    const defaultName = `${key.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.pub`
    const localPath = await localApi.saveFileDialog(defaultName)
    if (!localPath) return

    try {
      await localApi.executeLocalFileOp('writeFile', {
        path: localPath,
        content: key.publicKey
      })
      toast.success('Key exported successfully!')
    } catch {
      toast.error('Failed to export key')
    }
  }

  return (
    <div className="flex-1 p-8 bg-[#0a0a0f] h-full overflow-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-200">SSH Keys</h1>
          <p className="text-slate-500 mt-1">
            Manage cryptographic keys for secure authentication.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setImportBundleOpen(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
          >
            <PackageOpen className="w-4 h-4" /> Import Bundle
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
          >
            <Upload className="w-4 h-4" /> Import Key
          </button>
          <button
            onClick={() => setGenerateOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" /> Generate New
          </button>
        </div>
      </div>

      <KeyGeneratorModal open={generateOpen} onOpenChange={setGenerateOpen} />
      <KeyImportModal open={importOpen} onOpenChange={setImportOpen} />
      <ImportKeyBundleDialog open={importBundleOpen} onOpenChange={setImportBundleOpen} />
      {exportBundle && (
        <ExportKeyBundleDialog
          open={true}
          keyId={exportBundle.id}
          keyName={exportBundle.name}
          onOpenChange={(o) => {
            if (!o) setExportBundle(null)
          }}
        />
      )}

      {isLoading ? (
        <div className="text-slate-500">Loading keys...</div>
      ) : keys?.length === 0 ? (
        <div className="bg-[#151821] border border-slate-800 rounded-xl p-12 text-center">
          <Key className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-300">No SSH keys found</h3>
          <p className="text-slate-500 mt-2 max-w-sm mx-auto">
            Generate a new keypair or import an existing private key to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {keys?.map((key) => (
            <div
              key={key.id}
              className="bg-[#151821] border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Key className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-200">{key.name}</h3>
                    {key.description && <p className="text-sm text-slate-500">{key.description}</p>}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(key.id)}
                  className="p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-slate-500 mb-1">Algorithm</div>
                  <div className="text-slate-300 font-medium uppercase">{key.keyType}</div>
                </div>
                <div>
                  <div className="text-slate-500 mb-1">Created</div>
                  <div className="text-slate-300">
                    {format(new Date(key.createdAt), 'MMM d, yyyy')}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-slate-500 mb-1 flex items-center justify-between">
                    <span>Fingerprint (SHA256)</span>
                  </div>
                  <div className="text-slate-400 font-mono text-xs bg-slate-900 px-3 py-2 rounded border border-slate-800 break-all">
                    {key.fingerprint}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-4 flex-wrap">
                <button
                  onClick={() => copyToClipboard(key.publicKey)}
                  className="text-emerald-500 hover:text-emerald-400 text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <Copy className="w-4 h-4" /> Copy Public Key
                </button>
                <button
                  onClick={() => handleExport(key)}
                  className="text-blue-500 hover:text-blue-400 text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" /> Save to File
                </button>
                <button
                  onClick={() => setExportBundle({ id: key.id, name: key.name })}
                  className="text-violet-400 hover:text-violet-300 text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <PackageOpen className="w-4 h-4" /> Export Bundle
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
