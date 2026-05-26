import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { File, Folder, HardDriveUpload, RefreshCw, Trash2, Download, CheckCircle, XCircle, Loader2, FolderPlus, Edit, Shield } from 'lucide-react';
import { format } from 'date-fns';
import { useSFTPTransfer } from '../../hooks/useSFTPTransfer';
import { useTransferStore } from '../../store/transferStore';
import { LocalFilePane } from './LocalFilePane';

interface SftpPaneProps {
  sessionId: string;
}

export function SftpPane({ sessionId }: SftpPaneProps) {
  const [currentPath, setCurrentPath] = useState('.');

  const { data: files, isLoading, refetch, isError, error } = useQuery({
    queryKey: ['sftp', sessionId, currentPath],
    queryFn: async () => {
      const res = await api.get(`/sftp/${sessionId}/list`, { params: { path: currentPath } });
      return res.data.files;
    },
  });

  const { listenToTransfer, addTransfer } = useSFTPTransfer(sessionId);
  const transfers = useTransferStore(s => s.transfers);
  const clearCompleted = useTransferStore(s => s.clearCompleted);

  const handleNavigate = (file: any) => {
    if (file.type === 'd') {
      setCurrentPath(`${currentPath}/${file.name}`.replace(/^\.\//, ''));
    }
  };

  const handleUpload = async () => {
    const files = await (window as any).api.openFileDialog();
    if (!files || files.length === 0) return;
    await executeUpload(files[0]);
  };

  const executeUpload = async (localPath: string) => {
    const filename = localPath.split('\\').pop() || localPath.split('/').pop() || 'unknown';
    const remotePath = currentPath === '.' || currentPath === '' ? filename : `${currentPath}/${filename}`;
    const transferId = `up-${Date.now()}`;
    
    addTransfer({ id: transferId, filename, type: 'upload', status: 'progress', bytesTransferred: 0, totalBytes: 0, percent: 0 });
    
    try {
      // Open SSE listener FIRST so we don't miss events from fast transfers
      await listenToTransfer(transferId);
      api.post(`/sftp/${sessionId}/upload`, { localPath, remotePath, transferId }).catch(console.error);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDropToRemote = async (e: React.DragEvent) => {
    e.preventDefault();
    const localPath = e.dataTransfer.getData('text/plain');
    if (localPath) {
      await executeUpload(localPath);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await executeUpload(e.dataTransfer.files[0].path);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDownload = async (file: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (file.type === 'd') return alert('Directory download not supported yet');
    
    const localPath = await (window as any).api.saveFileDialog(file.name);
    if (!localPath) return;
    
    const remotePath = currentPath === '.' || currentPath === '' ? file.name : `${currentPath}/${file.name}`;
    await executeDownload(remotePath, localPath, file.name, file.size);
  };

  const executeDownload = async (remotePath: string, localPath: string, filename: string, size: number) => {
    const transferId = `dn-${Date.now()}`;
    addTransfer({ id: transferId, filename, type: 'download', status: 'progress', bytesTransferred: 0, totalBytes: size, percent: 0 });
    try {
      // Open SSE listener FIRST so we don't miss events from fast transfers
      await listenToTransfer(transferId);
      api.post(`/sftp/${sessionId}/download`, { remotePath, localPath, transferId }).catch(console.error);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (file: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete ${file.name}?`)) return;
    const remotePath = currentPath === '.' || currentPath === '' ? file.name : `${currentPath}/${file.name}`;
    
    try {
      await api.post(`/sftp/${sessionId}/delete`, { remotePath });
      refetch();
    } catch (err) {
      alert('Delete failed');
    }
  };

  const handleUp = () => {
    if (currentPath === '.' || currentPath === '') return;
    const parts = currentPath.split('/');
    parts.pop();
    setCurrentPath(parts.length ? parts.join('/') : '.');
  };

  const handleMkdir = async () => {
    const name = prompt('New folder name:');
    if (!name) return;
    const remotePath = currentPath === '.' || currentPath === '' ? name : `${currentPath}/${name}`;
    try {
      await api.post(`/sftp/${sessionId}/mkdir`, { remotePath });
      refetch();
    } catch (err) {
      alert('Failed to create folder');
    }
  };

  const handleRename = async (file: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const newName = prompt('Rename to:', file.name);
    if (!newName || newName === file.name) return;
    const oldPath = currentPath === '.' || currentPath === '' ? file.name : `${currentPath}/${file.name}`;
    const newPath = currentPath === '.' || currentPath === '' ? newName : `${currentPath}/${newName}`;
    try {
      await api.post(`/sftp/${sessionId}/rename`, { oldPath, newPath });
      refetch();
    } catch (err) {
      alert('Rename failed');
    }
  };

  const handleChmod = async (file: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentMode = file.permissions.toString(8).slice(-3);
    const newMode = prompt('New permissions (octal, e.g. 755):', currentMode);
    if (!newMode || newMode === currentMode || !/^[0-7]{3,4}$/.test(newMode)) return;
    const remotePath = currentPath === '.' || currentPath === '' ? file.name : `${currentPath}/${file.name}`;
    try {
      await api.post(`/sftp/${sessionId}/chmod`, { remotePath, mode: newMode });
      refetch();
    } catch (err) {
      alert('Chmod failed');
    }
  };

  const handleRemoteDragStart = (e: React.DragEvent, file: any) => {
    if (file.type === 'd') return;
    const remotePath = currentPath === '.' || currentPath === '' ? file.name : `${currentPath}/${file.name}`;
    e.dataTransfer.setData('application/x-remote-file', JSON.stringify({
      filename: file.name,
      remotePath,
      size: file.size
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="flex flex-col h-full bg-[#0f1117]">
      <div className="flex flex-1 overflow-hidden">
        {/* Left Pane: Local File System */}
        <div className="w-1/2 min-w-[300px]">
          <LocalFilePane sessionId={sessionId} onUpload={executeUpload} onDownload={executeDownload} />
        </div>

        {/* Right Pane: Remote File System */}
        <div
          className="w-1/2 flex flex-col min-w-[300px] border-l border-slate-800"
          onDrop={handleDropToRemote}
          onDragOver={handleDragOver}
        >
          <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800 bg-[#151821]">
            <button onClick={handleUp} className="text-slate-400 hover:text-slate-200">
              <Folder className="w-5 h-5" />
              <span className="sr-only">Up</span>
            </button>
            <div className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-300 font-mono text-sm truncate">
              {currentPath}
            </div>
            <button onClick={() => refetch()} className="text-slate-400 hover:text-slate-200">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={handleMkdir} className="text-emerald-500 hover:text-emerald-400 flex items-center gap-2 text-sm font-medium">
              <FolderPlus className="w-4 h-4" /> New Folder
            </button>
            <button onClick={handleUpload} className="text-emerald-500 hover:text-emerald-400 flex items-center gap-2 text-sm font-medium">
              <HardDriveUpload className="w-4 h-4" /> Upload
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4">
            {isLoading ? (
              <div className="text-slate-500 flex justify-center py-10">Loading directory...</div>
            ) : isError ? (
              <div className="text-red-500 flex justify-center py-10">Failed to list directory: {(error as any).message}</div>
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
                  {files?.map((f: any) => (
                    <tr
                      key={f.name}
                      onDoubleClick={() => handleNavigate(f)}
                      draggable={f.type !== 'd'}
                      onDragStart={(e) => handleRemoteDragStart(e, f)}
                      className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer group transition-colors"
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
                            <button onClick={(e) => handleDownload(f, e)} title="Download" className="p-1.5 hover:bg-slate-700 rounded text-blue-400">
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={(e) => handleRename(f, e)} title="Rename" className="p-1.5 hover:bg-slate-700 rounded text-slate-300">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={(e) => handleChmod(f, e)} title="Change Permissions" className="p-1.5 hover:bg-slate-700 rounded text-slate-300">
                            <Shield className="w-4 h-4" />
                          </button>
                          <button onClick={(e) => handleDelete(f, e)} title="Delete" className="p-1.5 hover:bg-slate-700 rounded text-red-400">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {files?.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-500">Empty directory</td>
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
            <button onClick={clearCompleted} className="text-xs text-slate-500 hover:text-slate-300">
              Clear Completed
            </button>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-2">
            {transfers.map((t) => (
              <div key={t.id} className="bg-[#1a1c23] border border-slate-800 rounded p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-slate-300 font-medium truncate">
                    {t.type === 'upload' ? <HardDriveUpload className="w-4 h-4 text-emerald-500" /> : <Download className="w-4 h-4 text-blue-500" />}
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
                        t.status === 'error' ? 'bg-red-500' : t.status === 'complete' ? 'bg-emerald-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, t.percent))}%` }}
                    />
                  </div>
                  <div className="w-16 text-right text-xs">
                    {t.status === 'progress' ? (
                      <span className="text-slate-400 flex items-center justify-end gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {t.percent}%</span>
                    ) : t.status === 'complete' ? (
                      <span className="text-emerald-500 flex items-center justify-end gap-1"><CheckCircle className="w-3 h-3" /> Done</span>
                    ) : (
                      <span className="text-red-500 flex items-center justify-end gap-1"><XCircle className="w-3 h-3" /> Error</span>
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
  );
}
