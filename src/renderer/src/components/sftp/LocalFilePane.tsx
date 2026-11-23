import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { File, Folder, RefreshCw } from 'lucide-react'
import { PathBreadcrumb } from './PathBreadcrumb'
import { reportError } from '../../lib/log'
import { LOCAL_FILE_MIME, localFileDragPayload, readRemoteFileDrag } from '../../lib/localFiles'

type LocalFileEntry = LocalDirEntry

interface LocalFilePaneProps {
  showHidden: boolean
  /** A remote file was dropped here; `folderGrant` is the grant of the folder that is open (BL-47). */
  onDownload: (
    remote: { filename: string; remotePath: string; size: number },
    folderGrant: string
  ) => void
}

/** The reason in an IPC error: Electron prefixes it with "Error invoking remote method …". */
function ipcMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']*': (Error: )?(LocalFileError: )?/, '')
}

export function LocalFilePane({ showHidden, onDownload }: LocalFilePaneProps): React.JSX.Element {
  const [listing, setListing] = useState<LocalDirListing | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const currentPath = listing?.path ?? ''
  const files: LocalFileEntry[] = listing?.files ?? []

  /** `path` undefined opens the home folder. Main checks every path; a refused one is shown, not opened. */
  const fetchDir = async (path?: string): Promise<void> => {
    setIsLoading(true)
    try {
      setListing(await window.api.readLocalDir(path))
    } catch (err) {
      toast.error(ipcMessage(err) || 'Could not open this folder')
      reportError('LocalFilePane', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // One-shot initial directory load. fetchDir flips a loading flag and then
    // resolves asynchronously; this is a genuine external-system fetch, not
    // derived render state, so the synchronous setState here is safe and intended.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchDir(undefined)
  }, [])

  const handleNavigate = (file: LocalFileEntry): void => {
    if (file.type === 'd') {
      const sep = currentPath.includes('\\') ? '\\' : '/'
      void fetchDir(`${currentPath.replace(/[\\/]+$/, '')}${sep}${file.name}`)
    }
  }

  // BL-47: main says what the parent is (null at the home folder), so no path maths here.
  const handleUp = (): void => {
    if (listing?.parent) void fetchDir(listing.parent)
  }

  const handleDragStart = (e: React.DragEvent, file: LocalFileEntry): void => {
    if (!listing) return
    // A grant for the open folder plus the file's name — never a path, never text/plain.
    e.dataTransfer.setData(LOCAL_FILE_MIME, localFileDragPayload(listing.grant, file.name))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const remote = readRemoteFileDrag(e.dataTransfer)
    if (!remote || !listing) return
    onDownload(remote, listing.grant)
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
  }

  return (
    <div
      className="flex flex-col h-full bg-[#0f1117] border-r border-slate-800"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800 bg-[#151821]">
        <button
          onClick={handleUp}
          disabled={!listing?.parent}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-40"
        >
          <Folder className="w-5 h-5" />
          <span className="sr-only">Up</span>
        </button>
        <PathBreadcrumb path={currentPath} onNavigate={(p) => void fetchDir(p)} />
        <button
          onClick={() => void fetchDir(currentPath || undefined)}
          className="text-slate-400 hover:text-slate-200"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="sr-only">Refresh</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading && !listing ? (
          <div className="text-slate-500 flex justify-center py-10">Loading local directory...</div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase border-b border-slate-800">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {files
                .filter((f) => showHidden || !f.name.startsWith('.'))
                .map((f) => (
                  <tr
                    key={f.name}
                    onDoubleClick={() => handleNavigate(f)}
                    draggable={f.type !== 'd'}
                    onDragStart={(e) => handleDragStart(e, f)}
                    className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer group transition-colors"
                  >
                    <td
                      className="px-4 py-2 font-medium text-slate-300 flex items-center gap-3 truncate max-w-[200px]"
                      title={f.name}
                    >
                      {f.type === 'd' ? (
                        <Folder className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <File className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                      <span className="truncate">{f.name}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                      {f.type === 'd' ? '--' : (f.size / 1024).toFixed(1) + ' KB'}
                    </td>
                  </tr>
                ))}
              {files.length === 0 && (
                <tr>
                  <td colSpan={2} className="text-center py-8 text-slate-500">
                    Empty directory
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
