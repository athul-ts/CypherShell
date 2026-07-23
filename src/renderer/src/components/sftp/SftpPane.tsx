import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  File,
  Folder,
  HardDriveUpload,
  RefreshCw,
  Trash2,
  Download,
  CheckCircle,
  XCircle,
  Loader2,
  FolderPlus,
  Edit,
  Shield,
  X,
  Eye,
  EyeOff
} from 'lucide-react'
import { format } from 'date-fns'
import { useSFTPTransfer } from '../../hooks/useSFTPTransfer'
import { useTransferStore } from '../../store/transferStore'
import { LocalFilePane } from './LocalFilePane'
import { PathBreadcrumb } from './PathBreadcrumb'

interface SftpPaneProps {
  sessionId: string
}

interface RemoteFileEntry {
  name: string
  type: 'd' | '-'
  size: number
  modifyTime: number
  accessTime: number
  permissions: number
}

// Module-scoped so the impure Date.now() call lives outside React's render path.
function makeTransferId(prefix: 'up' | 'dn'): string {
  return `${prefix}-${Date.now()}`
}

/** FUN-14: Normalize a remote SFTP path, handling '.', '..', and extra slashes. */
function normalizeSftpPath(base: string, name: string): string {
  const joined = !base || base === '.' ? name : `${base}/${name}`
  const parts = joined.split('/')
  const result: string[] = []
  for (const part of parts) {
    if (part === '..') {
      if (result.length > 0) result.pop()
    } else if (part && part !== '.') {
      result.push(part)
    }
  }
  return result.join('/') || '.'
}

export function SftpPane({ sessionId }: SftpPaneProps): React.JSX.Element {
  const [currentPath, setCurrentPath] = useState('.')
  const [selectedFile, setSelectedFile] = useState<RemoteFileEntry | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const remoteRef = useRef<HTMLDivElement>(null)

  const {
    data: files,
    isLoading,
    refetch,
    isError,
    error
  } = useQuery({
    queryKey: ['sftp', sessionId, currentPath, showHidden],
    queryFn: async (): Promise<RemoteFileEntry[]> => {
      const res = await api.get<{ files: RemoteFileEntry[] }>(`/sftp/${sessionId}/list`, {
        params: { path: currentPath, showHidden: String(showHidden) }
      })
      return res.data.files
    }
  })

  const { listenToTransfer, addTransfer } = useSFTPTransfer(sessionId)
  const transfers = useTransferStore((s) => s.transfers)
  const clearCompleted = useTransferStore((s) => s.clearCompleted)
  const cancelTransferStore = useTransferStore((s) => s.cancelTransfer)

  const handleCancel = async (transferId: string): Promise<void> => {
    cancelTransferStore(transferId)
    try {
      await api.delete(`/sftp/${sessionId}/transfer/${transferId}`)
    } catch {
      // best-effort — store is already marked cancelled
    }
  }

  const handleNavigate = (file: RemoteFileEntry): void => {
    if (file.type === 'd') {
      setCurrentPath(normalizeSftpPath(currentPath, file.name))
    }
  }

  const handleUpload = async (): Promise<void> => {
    const files = await window.api.openFileDialog()
    if (!files || files.length === 0) return
    await executeUpload(files[0])
  }

  const executeUpload = async (localPath: string): Promise<void> => {
    const filename = localPath.split('\\').pop() || localPath.split('/').pop() || 'unknown'
    const remotePath =
      normalizeSftpPath(currentPath, filename)
    const transferId = makeTransferId('up')

    addTransfer({
      id: transferId,
      filename,
      type: 'upload',
      status: 'progress',
      bytesTransferred: 0,
      totalBytes: 0,
      percent: 0
    })

    try {
      // Open SSE listener FIRST so we don't miss events from fast transfers
      await listenToTransfer(transferId)
      api
        .post(`/sftp/${sessionId}/upload`, { localPath, remotePath, transferId })
        .catch(console.error)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDropToRemote = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    const localPath = e.dataTransfer.getData('text/plain')
    if (localPath) {
      await executeUpload(localPath)
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // Electron exposes the absolute path on dropped File objects via a non-standard `path` field
      await executeUpload((e.dataTransfer.files[0] as File & { path: string }).path)
    }
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
  }

  const handleDownload = async (file: RemoteFileEntry, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (file.type === 'd') return alert('Directory download not supported yet')

    const localPath = await window.api.saveFileDialog(file.name)
    if (!localPath) return

    const remotePath =
      normalizeSftpPath(currentPath, file.name)
    await executeDownload(remotePath, localPath, file.name, file.size)
  }

  const executeDownload = async (
    remotePath: string,
    localPath: string,
    filename: string,
    size: number
  ): Promise<void> => {
    const transferId = makeTransferId('dn')
    addTransfer({
      id: transferId,
      filename,
      type: 'download',
      status: 'progress',
      bytesTransferred: 0,
      totalBytes: size,
      percent: 0
    })
    try {
      // Open SSE listener FIRST so we don't miss events from fast transfers
      await listenToTransfer(transferId)
      api
        .post(`/sftp/${sessionId}/download`, { remotePath, localPath, transferId })
        .catch(console.error)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async (file: RemoteFileEntry, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!confirm(`Are you sure you want to delete ${file.name}?`)) return
    const remotePath =
      normalizeSftpPath(currentPath, file.name)

    try {
      await api.post(`/sftp/${sessionId}/delete`, { remotePath })
      refetch()
    } catch {
      alert('Delete failed')
    }
  }

  const handleUp = (): void => {
    if (currentPath === '.' || currentPath === '') return
    const parts = currentPath.split('/')
    parts.pop()
    setCurrentPath(parts.length ? parts.join('/') : '.')
  }

  const handleMkdir = async (): Promise<void> => {
    const name = prompt('New folder name:')
    if (!name) return
    const remotePath = normalizeSftpPath(currentPath, name)
    try {
      await api.post(`/sftp/${sessionId}/mkdir`, { remotePath })
      refetch()
    } catch {
      alert('Failed to create folder')
    }
  }

  useEffect(() => {
    const onKey = async (e: KeyboardEvent): Promise<void> => {
      if (
        !remoteRef.current?.contains(document.activeElement) &&
        document.activeElement !== document.body
      )
        return
      if (e.key === 'F2' && selectedFile) {
        e.preventDefault()
        const newName = prompt('Rename to:', selectedFile.name)
        if (!newName || newName === selectedFile.name) return
        const oldPath =
          normalizeSftpPath(currentPath, selectedFile.name)
        const newPath = normalizeSftpPath(currentPath, newName)
        try {
          await api.post(`/sftp/${sessionId}/rename`, { oldPath, newPath })
          refetch()
        } catch {
          alert('Rename failed')
        }
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'N') {
        e.preventDefault()
        handleMkdir()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedFile, currentPath])

  const handleRename = async (file: RemoteFileEntry, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const newName = prompt('Rename to:', file.name)
    if (!newName || newName === file.name) return
    const oldPath =
      normalizeSftpPath(currentPath, file.name)
    const newPath = normalizeSftpPath(currentPath, newName)
    try {
      await api.post(`/sftp/${sessionId}/rename`, { oldPath, newPath })
      refetch()
    } catch {
      alert('Rename failed')
    }
  }

  const handleChmod = async (file: RemoteFileEntry, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const currentMode = file.permissions.toString(8).slice(-3)
    const newMode = prompt('New permissions (octal, e.g. 755):', currentMode)
    if (!newMode || newMode === currentMode || !/^[0-7]{3,4}$/.test(newMode)) return
    const remotePath =
      normalizeSftpPath(currentPath, file.name)
    try {
      await api.post(`/sftp/${sessionId}/chmod`, { remotePath, mode: newMode })
      refetch()
    } catch {
      alert('Chmod failed')
    }
  }

  const handleRemoteDragStart = (e: React.DragEvent, file: RemoteFileEntry): void => {
    if (file.type === 'd') return
    const remotePath =
      normalizeSftpPath(currentPath, file.name)
    e.dataTransfer.setData(
      'application/x-remote-file',
      JSON.stringify({
        filename: file.name,
        remotePath,
        size: file.size
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="flex flex-col h-full bg-[#0f1117]">
      <div className="flex flex-1 overflow-hidden">
        {/* Left Pane: Local File System */}
        <div className="w-1/2 min-w-[300px]">
          <LocalFilePane
            sessionId={sessionId}
            showHidden={showHidden}
            onUpload={executeUpload}
            onDownload={executeDownload}
          />
        </div>

        {/* Right Pane: Remote File System */}
        <div
          ref={remoteRef}
          className="w-1/2 flex flex-col min-w-[300px] border-l border-slate-800"
          onDrop={handleDropToRemote}
          onDragOver={handleDragOver}
        >
          <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800 bg-[#151821]">
            <button onClick={handleUp} className="text-slate-400 hover:text-slate-200">
              <Folder className="w-5 h-5" />
              <span className="sr-only">Up</span>
            </button>
            <PathBreadcrumb path={currentPath} onNavigate={setCurrentPath} />
            <button onClick={() => refetch()} className="text-slate-400 hover:text-slate-200">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
              className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${showHidden ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {showHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button
              onClick={handleMkdir}
              className="text-emerald-500 hover:text-emerald-400 flex items-center gap-2 text-sm font-medium"
            >
              <FolderPlus className="w-4 h-4" /> New Folder
            </button>
            <button
              onClick={handleUpload}
              className="text-emerald-500 hover:text-emerald-400 flex items-center gap-2 text-sm font-medium"
            >
              <HardDriveUpload className="w-4 h-4" /> Upload
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4">
            {isLoading ? (
              <div className="text-slate-500 flex justify-center py-10">Loading directory...</div>
            ) : isError ? (
              <div className="text-red-500 flex justify-center py-10">
                Failed to list directory: {(error as Error).message}
              </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Size</th>
                    <th className="px-4 py-2 font-medium">Modified</th>
                    <th className="px-4 py-2 font-medium">Perms</th>
                  </tr>
                </thead>
                <tbody>
                  {files?.map((f) => (
                    <tr
                      key={f.name}
                      onClick={() => setSelectedFile(f)}
                      onDoubleClick={() => handleNavigate(f)}
                      draggable={f.type !== 'd'}
                      onDragStart={(e) => handleRemoteDragStart(e, f)}
                      className={`border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer group transition-colors ${selectedFile?.name === f.name ? 'bg-slate-800/50' : ''}`}
                    >
                      <td className="px-4 py-2 font-medium text-slate-300 flex items-center gap-3">
                        {f.type === 'd' ? (
                          <Folder className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <File className="w-4 h-4 text-slate-500" />
                        )}
                        {f.name}
                      </td>
                      <td className="px-4 py-2 text-slate-400">
                        {f.type === 'd' ? '--' : (f.size / 1024).toFixed(1) + ' KB'}
                      </td>
                      <td className="px-4 py-2 text-slate-400">
                        {format(new Date(f.modifyTime), 'MMM d, yyyy HH:mm')}
                      </td>
                      <td className="px-4 py-2 text-slate-500 font-mono text-xs">
                        {f.permissions.toString(8).slice(-3)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {f.type !== 'd' && (
                            <button
                              onClick={(e) => handleDownload(f, e)}
                              title="Download"
                              className="p-1.5 hover:bg-slate-700 rounded text-blue-400"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleRename(f, e)}
                            title="Rename"
                            className="p-1.5 hover:bg-slate-700 rounded text-slate-300"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleChmod(f, e)}
                            title="Change Permissions"
                            className="p-1.5 hover:bg-slate-700 rounded text-slate-300"
                          >
                            <Shield className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(f, e)}
                            title="Delete"
                            className="p-1.5 hover:bg-slate-700 rounded text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {files?.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-500">
                        Empty directory
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Transfer Queue Panel */}
      {transfers.length > 0 && (
        <div className="h-48 border-t border-slate-800 bg-[#151821] flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
            <span className="text-sm font-medium text-slate-300">Transfer Queue</span>
            <button
              onClick={clearCompleted}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Clear Completed
            </button>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-2">
            {transfers.map((t) => (
              <div
                key={t.id}
                className="bg-[#1a1c23] border border-slate-800 rounded p-3 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-slate-300 font-medium truncate">
                    {t.type === 'upload' ? (
                      <HardDriveUpload className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Download className="w-4 h-4 text-blue-500" />
                    )}
                    <span className="truncate">{t.filename}</span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    {t.bytesTransferred > 0 && t.totalBytes > 0
                      ? `${(t.bytesTransferred / 1024 / 1024).toFixed(1)} / ${(t.totalBytes / 1024 / 1024).toFixed(1)} MB`
                      : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        t.status === 'error'
                          ? 'bg-red-500'
                          : t.status === 'complete'
                            ? 'bg-emerald-500'
                            : t.status === 'cancelled'
                              ? 'bg-slate-600'
                              : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, t.percent))}%` }}
                    />
                  </div>
                  <div className="w-24 text-right text-xs flex items-center justify-end gap-1">
                    {t.status === 'progress' ? (
                      <>
                        <span className="text-slate-400 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> {t.percent}%
                        </span>
                        <button
                          onClick={() => handleCancel(t.id)}
                          title="Cancel transfer"
                          className="ml-1 p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </>
                    ) : t.status === 'complete' ? (
                      <span className="text-emerald-500 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Done
                      </span>
                    ) : t.status === 'cancelled' ? (
                      <span className="text-slate-500 flex items-center gap-1">
                        <XCircle className="w-3 h-3" /> Cancelled
                      </span>
                    ) : (
                      <span className="text-red-500 flex items-center gap-1">
                        <XCircle className="w-3 h-3" /> Error
                      </span>
                    )}
                  </div>
                </div>
                {t.error && <div className="text-xs text-red-400 truncate">{t.error}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
