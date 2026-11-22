/**
 * BL-46 / ADR-005: the backend runs in an Electron utility process and gets its two secrets in a
 * message, not in its environment. It announces itself with `{ type: 'ready' }`; main answers
 * with `{ type: 'init', storageKey, launchSecret }`. No Electron imports, so it is unit-tested.
 */
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
