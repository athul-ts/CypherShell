import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';

export function UpdateBanner() {
  const [updateState, setUpdateState] = useState<'idle' | 'available' | 'downloaded'>('idle');

  useEffect(() => {
    const removeAvailable = window.api.onUpdateAvailable(() => {
      setUpdateState('available');
    });
    const removeDownloaded = window.api.onUpdateDownloaded(() => {
      setUpdateState('downloaded');
    });

    return () => {
      removeAvailable();
      removeDownloaded();
    };
  }, []);

  if (updateState === 'idle') return null;

  return (
    <div className={`flex items-center justify-between px-4 py-2 text-sm border-b shrink-0 ${
      updateState === 'downloaded'
        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
        : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
    }`}>
      <div className="flex items-center gap-2">
        <Download className="w-4 h-4" />
        {updateState === 'available'
          ? 'A new version is downloading in the background...'
          : 'Update downloaded! Restart the app to apply the new version.'}
      </div>
      {updateState === 'downloaded' && (
        <button
          onClick={() => window.api.installUpdate()}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-md font-medium transition-colors text-xs"
        >
          <RefreshCw className="w-3 h-3" /> Restart & Install
        </button>
      )}
    </div>
  );
}
