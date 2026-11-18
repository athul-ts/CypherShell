import { logger } from './logger.service'

/**
 * Messages exchanged with the Electron main process over the child-process
 * IPC channel (BL-18). Main spawns the backend with `stdio: [..., 'ipc']` and
 * sets `CYPHERSHELL_HOST_IPC=1`. Without that flag — standalone runs, or test
 * workers whose `process.send` belongs to the test runner — the bridge is
 * off and every send is a no-op.
 */
export type BackendToMainMessage =
  | { type: 'locked' }
  | { type: 'lock-policy'; enabled: boolean; autoLockMinutes: number }

export type MainToBackendMessage = { type: 'lock' }

function isMainToBackendMessage(message: unknown): message is MainToBackendMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'lock'
  )
}

export const HostBridge = {
  /** True while the IPC channel to the main process is open. */
  isConnected(): boolean {
    return (
      process.env.CYPHERSHELL_HOST_IPC === '1' &&
      typeof process.send === 'function' &&
      process.connected === true
    )
  },

  send(message: BackendToMainMessage): void {
    if (!HostBridge.isConnected()) return
    try {
      process.send?.(message, undefined, undefined, (err: Error | null) => {
        if (err) logger.warn(`Could not notify the main process (${message.type}): ${err.message}`)
      })
    } catch (err) {
      logger.warn(`Could not notify the main process (${message.type}): ${String(err)}`)
    }
  },

  /** Calls `handler` for every well-formed message from the main process. */
  onMessage(handler: (message: MainToBackendMessage) => void): void {
    process.on('message', (message: unknown) => {
      if (isMainToBackendMessage(message)) handler(message)
    })
  },

  /** Calls `handler` once the channel closes — the main process has gone away. */
  onDisconnect(handler: () => void): void {
    if (HostBridge.isConnected()) process.once('disconnect', handler)
  }
}
