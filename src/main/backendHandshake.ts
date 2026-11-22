/**
 * BL-46 / ADR-005: the backend runs in an Electron utility process and gets its two secrets in a
 * message, not in its environment. It announces itself with `{ type: 'ready' }`; main answers
 * with `{ type: 'init', storageKey, launchSecret }`. No Electron imports, so it is unit-tested.
 */
import { parseBackendMessage, type BackendMessage } from './idleLock'
import { parseGrantResolveRequest, type GrantResolveRequest } from './localGrants'

export interface StartupSecrets {
  storageKey: string
  launchSecret: string
}

/** The part of a utility process (or a test fake) the handshake uses. */
export interface MessagingProcess {
  on(event: 'message', listener: (message: unknown) => void): unknown
  postMessage(message: unknown): void
}

/**
 * Answers the backend's `ready` message once with the secrets and passes every other message
 * to `onMessage`.
 */
export function attachBackendHandshake(
  child: MessagingProcess,
  secrets: StartupSecrets,
  onMessage: (message: unknown) => void
): void {
  let answered = false
  child.on('message', (message) => {
    const type = (message as { type?: unknown } | null)?.type
    if (type === 'ready') {
      if (!answered) {
        answered = true
        child.postMessage({ type: 'init', ...secrets })
      }
      return
    }
    onMessage(message)
  })
}

export interface BackendMessageHandlers {
  lockPolicy: (message: Extract<BackendMessage, { type: 'lock-policy' }>) => void
  locked: () => void
  /** BL-47: the backend asks main to resolve an SFTP local-file grant. */
  grantResolve: (request: GrantResolveRequest) => void
}

/**
 * Routes a message from the backend (BL-47). Grant requests are parsed first; the lock messages
 * follow; anything else is ignored — an unknown message is never treated as a lock.
 */
export function routeBackendMessage(raw: unknown, handlers: BackendMessageHandlers): void {
  const grantRequest = parseGrantResolveRequest(raw)
  if (grantRequest) return handlers.grantResolve(grantRequest)
  const message = parseBackendMessage(raw)
  if (!message) return
  if (message.type === 'locked') handlers.locked()
  else handlers.lockPolicy(message)
}
