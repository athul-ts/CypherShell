import { useState, useEffect } from 'react';
import { File, Folder, RefreshCw } from 'lucide-react';
import { PathBreadcrumb } from './PathBreadcrumb';

interface LocalFilePaneProps {
  sessionId: string;
  showHidden: boolean;
  onUpload: (localPath: string) => void;
  onDownload: (remotePath: string, localPath: string, filename: string, size: number) => void;
}

export function LocalFilePane({ sessionId: _sessionId, showHidden, onUpload: _onUpload, onDownload }: LocalFilePaneProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchDir = async (path?: string) => {
    setIsLoading(true);
    try {
      const res = await (window as any).api.readLocalDir(path || currentPath);
      setCurrentPath(res.path);
      setFiles(res.files);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDir('');
  }, []);

  const handleNavigate = (file: any) => {
    if (file.type === 'd') {
      const sep = currentPath.includes('\\') ? '\\' : '/';
      fetchDir(`${currentPath}${sep}${file.name}`);
    }
  };

  const handleUp = () => {
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(sep).filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      fetchDir(parts.join(sep) + (currentPath.startsWith(sep) ? '' : sep));
    } else {
      fetchDir(sep);
    }
  };

  const handleDragStart = (e: React.DragEvent, file: any) => {
    const sep = currentPath.includes('\\') ? '\\' : '/';
    e.dataTransfer.setData('text/plain', `${currentPath}${sep}${file.name}`);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/x-remote-file');
    if (!data) return;
    const { filename, remotePath, size } = JSON.parse(data);
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const localPath = `${currentPath}${sep}${filename}`;
    onDownload(remotePath, localPath, filename, size);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <div 
      className="flex flex-col h-full bg-[#0f1117] border-r border-slate-800"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800 bg-[#151821]">
        <button onClick={handleUp} className="text-slate-400 hover:text-slate-200">
          <Folder className="w-5 h-5" />
          <span className="sr-only">Up</span>
        </button>
        <PathBreadcrumb path={currentPath} onNavigate={fetchDir} />
        <button onClick={() => fetchDir(currentPath)} className="text-slate-400 hover:text-slate-200">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
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
              {files.filter(f => showHidden || !f.name.startsWith('.')).map((f: any) => (
                <tr 
                  key={f.name} 
                  onDoubleClick={() => handleNavigate(f)}
                  draggable={f.type !== 'd'}
                  onDragStart={(e) => handleDragStart(e, f)}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer group transition-colors"
                >
                  <td className="px-4 py-2 font-medium text-slate-300 flex items-center gap-3 truncate max-w-[200px]" title={f.name}>
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
                  <td colSpan={2} className="text-center py-8 text-slate-500">Empty directory</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
