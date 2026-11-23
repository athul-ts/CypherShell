import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Button } from '../ui/button'

export interface InputDialogProps {
  open: boolean
  title: string
  description?: string
  label: string
  initialValue?: string
  confirmLabel: string
  placeholder?: string
  /** Returns an error message for an invalid value, or `null` if it is fine. */
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void | Promise<void>
  onCancel: () => void
}

/**
 * Single-field text prompt for SFTP rename, new folder and chmod (BL-14).
 * Replaces `window.prompt()`, which Electron does not implement — it returns
 * nothing, so those actions silently did nothing.
 *
 * Mount it with a `key` per request so each opening starts from its own
 * initial value.
 */
export function InputDialog({
  open,
  title,
  description,
  label,
  initialValue = '',
  confirmLabel,
  placeholder,
  validate,
  onSubmit,
  onCancel
}: InputDialogProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmed = value.trim()
    const problem = !trimmed ? `${label} is required.` : (validate?.(trimmed) ?? null)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      await onSubmit(trimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md border-slate-800 bg-[#151821] text-slate-200">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription className="text-slate-400">{description}</DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="sftp-input-dialog" className="text-sm font-medium text-slate-400">
              {label}
            </label>
            <Input
              id="sftp-input-dialog"
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(e) => {
                setValue(e.target.value)
                setError(null)
              }}
              className="border-slate-700 bg-[#0f1117] font-mono text-slate-200"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
