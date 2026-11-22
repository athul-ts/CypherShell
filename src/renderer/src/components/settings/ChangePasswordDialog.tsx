import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { MIN_MASTER_PASSWORD_LENGTH } from '../../lib/passwordStrength'
import { PasswordStrengthHint } from '../PasswordStrengthHint'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

interface ChangePasswordDialogProps {
  open: boolean
  onClose: () => void
}

function apiErrorMessage(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error
}

/** Settings → Security → Change master password (FR-07.8, BL-39). */
export function ChangePasswordDialog({
  open,
  onClose
}: ChangePasswordDialogProps): React.JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const close = (): void => {
    setCurrent('')
    setNext('')
    setConfirm('')
    setError('')
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (next.length < MIN_MASTER_PASSWORD_LENGTH) {
      setError(`The new password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters.`)
      return
    }
    if (next !== confirm) {
      setError('The new passwords do not match.')
      return
    }
    if (next === current) {
      setError('The new password must be different from the current one.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data } = await api.post<{ unreadableSecrets?: number }>('/auth/change-password', {
        currentPassword: current,
        newPassword: next
      })
      if (data.unreadableSecrets) {
        toast.warning(
          `Master password changed, but ${data.unreadableSecrets} saved secret(s) could not be recovered. Re-enter those passwords or keys.`
        )
      } else {
        toast.success('Master password changed.')
      }
      close()
    } catch (err: unknown) {
      setError(apiErrorMessage(err) || 'Could not change the master password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change master password</DialogTitle>
          <DialogDescription>
            Your saved passwords and keys are re-encrypted with the new password. If you forget it,
            that data cannot be recovered.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="cp-current" className="text-sm font-medium">
              Current master password
            </label>
            <Input
              id="cp-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="cp-new" className="text-sm font-medium">
              New master password
            </label>
            <Input
              id="cp-new"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={`Minimum ${MIN_MASTER_PASSWORD_LENGTH} characters`}
            />
            <PasswordStrengthHint password={next} />
          </div>
          <div className="space-y-1">
            <label htmlFor="cp-confirm" className="text-sm font-medium">
              Confirm new master password
            </label>
            <Input
              id="cp-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && (
            <div className="text-red-400 text-sm bg-red-950/30 border border-red-900/40 rounded-xl px-4 py-3">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !current || !next || !confirm}>
              {busy ? 'Working…' : 'Change password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
