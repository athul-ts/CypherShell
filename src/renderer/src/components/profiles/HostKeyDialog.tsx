import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Button } from '../ui/button'

/** The body of a 409 from `POST /profiles/:id/connect` (BL-38). */
export interface HostKeyInfo {
  code: 'HOST_KEY_UNKNOWN' | 'HOST_KEY_MISMATCH'
  host: string
  port: number
  keyType: string
  fingerprint: string
  knownKeyType?: string
  knownFingerprint?: string
}

interface HostKeyDialogProps {
  info: HostKeyInfo | null
  /** Unknown key only: the user confirmed the fingerprint shown. */
  onTrust: () => void
  onClose: () => void
}

function Fingerprint({ value }: { value: string }): React.JSX.Element {
  return (
    <code className="block break-all rounded bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 select-all">
      {value}
    </code>
  )
}

export function HostKeyDialog({ info, onTrust, onClose }: HostKeyDialogProps): React.JSX.Element {
  const changed = info?.code === 'HOST_KEY_MISMATCH'
  return (
    <Dialog open={info !== null} onOpenChange={(open) => !open && onClose()}>
      {info && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={changed ? 'text-red-400' : undefined}>
              {changed ? 'Host key has changed' : 'Trust this host?'}
            </DialogTitle>
            <DialogDescription>
              {changed ? (
                <>
                  The key presented by{' '}
                  <span className="font-mono">
                    {info.host}:{info.port}
                  </span>{' '}
                  is not the one you trusted before. Someone may be impersonating the server. No
                  password or key was sent.
                </>
              ) : (
                <>
                  First connection to{' '}
                  <span className="font-mono">
                    {info.host}:{info.port}
                  </span>
                  . Check that this fingerprint matches the server before you continue.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {changed && (
              <div>
                <div className="mb-1 text-slate-400">Trusted key ({info.knownKeyType})</div>
                <Fingerprint value={info.knownFingerprint ?? ''} />
              </div>
            )}
            <div>
              <div className="mb-1 text-slate-400">
                {changed ? 'Presented key' : 'Key type'}{' '}
                {changed ? (
                  `(${info.keyType})`
                ) : (
                  <span className="text-slate-200">{info.keyType}</span>
                )}
              </div>
              <Fingerprint value={info.fingerprint} />
            </div>
            {changed ? (
              <p className="text-slate-400">
                If the server was reinstalled, remove the old key under Settings → Known Hosts and
                connect again.
              </p>
            ) : (
              <p className="text-slate-400">
                On the server: <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>
              </p>
            )}
          </div>

          <DialogFooter>
            {changed ? (
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={onTrust}>Trust and connect</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
