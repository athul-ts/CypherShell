import { useEffect, useState } from 'react'
import { Download, ExternalLink, RefreshCw } from 'lucide-react'

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'downloading' }
  | { kind: 'downloaded' }
  /** BL-24: macOS — the unsigned build cannot install updates, so the user downloads it. */
  | { kind: 'manual'; version: string }

export function UpdateBanner(): React.JSX.Element | null {
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' })

  useEffect(() => {
    const removeAvailable = window.api.onUpdateAvailable((info) => {
      setUpdate(info?.manual ? { kind: 'manual', version: info.version } : { kind: 'downloading' })
    })
    const removeDownloaded = window.api.onUpdateDownloaded(() => {
      setUpdate({ kind: 'downloaded' })
    })

    return () => {
      removeAvailable()
      removeDownloaded()
    }
  }, [])

  if (update.kind === 'idle') return null

  if (update.kind === 'manual') {
    return (
      <div className="flex items-center justify-between px-4 py-2 text-sm border-b shrink-0 bg-blue-500/10 border-blue-500/20 text-blue-400">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4" />
          CypherShell {update.version} is available.
        </div>
        <button
          onClick={() => window.api.openDownloadPage()}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-md font-medium transition-colors text-xs"
        >
          <ExternalLink className="w-3 h-3" /> Download from GitHub Releases
        </button>
      </div>
    )
  }

  return (
    <div
      className={`flex items-center justify-between px-4 py-2 text-sm border-b shrink-0 ${
        update.kind === 'downloaded'
          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
          : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
      }`}
    >
      <div className="flex items-center gap-2">
        <Download className="w-4 h-4" />
        {update.kind === 'downloading'
          ? 'A new version is downloading in the background...'
          : 'Update downloaded! Restart the app to apply the new version.'}
      </div>
      {update.kind === 'downloaded' && (
        <button
          onClick={() => window.api.installUpdate()}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-md font-medium transition-colors text-xs"
        >
          <RefreshCw className="w-3 h-3" /> Restart & Install
        </button>
      )}
    </div>
  )
}
