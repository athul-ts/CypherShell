import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

type Resolution = 'skip' | 'rename' | 'overwrite';

interface Props {
  open: boolean;
  conflicts: string[];
  onResolve: (resolutions: Record<string, Resolution>) => void;
  onCancel: () => void;
}

export function ImportConflictDialog({ open, conflicts, onResolve, onCancel }: Props) {
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(() =>
    Object.fromEntries(conflicts.map(name => [name, 'skip' as Resolution]))
  );

  const handleResolve = (name: string, value: Resolution) => {
    setResolutions(prev => ({ ...prev, [name]: value }));
  };

  const handleApply = () => {
    onResolve(resolutions);
  };

  return (
    <Dialog.Root open={open} onOpenChange={open => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[#1a1c23] border border-slate-800 rounded-xl shadow-2xl w-full max-w-lg p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold text-slate-200">
                  Import Conflicts
                </Dialog.Title>
                <Dialog.Description className="text-sm text-slate-500 mt-0.5">
                  {conflicts.length} profile{conflicts.length !== 1 ? 's' : ''} already exist. Choose an action for each.
                </Dialog.Description>
              </div>
            </div>
            <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {conflicts.map(name => (
              <div key={name} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                <p className="text-sm font-medium text-slate-200 mb-2 truncate">{name}</p>
                <div className="flex gap-2">
                  {(['skip', 'rename', 'overwrite'] as Resolution[]).map(action => (
                    <button
                      key={action}
                      onClick={() => handleResolve(name, action)}
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                        resolutions[name] === action
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
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 mt-5">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
            >
              Import
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
