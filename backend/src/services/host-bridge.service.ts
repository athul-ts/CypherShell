import { logger } from './logger.service'

/**
 * Messages exchanged with the Electron main process (BL-18, BL-46).
 *
 * In the packaged app the backend is an Electron utility process and talks over
 * `process.parentPort`. A backend started as a plain child process with a Node IPC channel
 * (`CYPHERSHELL_HOST_IPC=1`) uses `process.send` instead — that path remains for tests and
 * debugging. Without either — standalone runs, or test workers whose `process.send` belongs to
 * the test runner — the bridge is off and every send is a no-op.
 */
export type BackendToMainMessage =
  | { type: 'locked' }
  | { type: 'lock-policy'; enabled: boolean; autoLockMinutes: number }

export type MainToBackendMessage = { type: 'lock' }

/** The start-up secrets main sends in its first message (BL-46). */
export interface InitSecrets {
  storageKey: string
  launchSecret: string
}

/** The part of Electron's `process.parentPort` the backend uses. */
interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown
  off(event: 'message', listener: (event: { data: unknown }) => void): unknown
}

function parentPort(): ParentPort | undefined {
  return (process as unknown as { parentPort?: ParentPort }).parentPort
}

function isMainToBackendMessage(message: unknown): message is MainToBackendMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'lock'
  )
}

function parseInit(message: unknown): InitSecrets | null {
  if (typeof message !== 'object' || message === null) return null
  const { type, storageKey, launchSecret } = message as Record<string, unknown>
  if (type !== 'init') return null
  if (typeof storageKey !== 'string' || typeof launchSecret !== 'string') return null
  return { storageKey, launchSecret }
}

export const HostBridge = {
  /** True while a channel to the main process is open. */
  isConnected(): boolean {
    if (parentPort()) return true
    return (
      process.env.CYPHERSHELL_HOST_IPC === '1' &&
      typeof process.send === 'function' &&
      process.connected === true
    )
  },

  send(message: BackendToMainMessage): void {
    if (!HostBridge.isConnected()) return
    const port = parentPort()
    try {
      if (port) {
        port.postMessage(message)
        return
      }
      process.send?.(message, undefined, undefined, (err: Error | null) => {
        if (err) logger.warn(`Could not notify the main process (${message.type}): ${err.message}`)
      })
    } catch (err) {
      logger.warn(`Could not notify the main process (${message.type}): ${String(err)}`)
    }
  },

  /** Calls `handler` for every well-formed message from the main process. */
  onMessage(handler: (message: MainToBackendMessage) => void): void {
    const port = parentPort()
    if (port) {
      port.on('message', (event) => {
        if (isMainToBackendMessage(event.data)) handler(event.data)
      })
      return
    }
    process.on('message', (message: unknown) => {
      if (isMainToBackendMessage(message)) handler(message)
    })
  },

  /**
   * Calls `handler` once the channel closes — the main process has gone away. A utility process
   * has no such event: Electron ends it together with the app.
   */
  onDisconnect(handler: () => void): void {
    if (!parentPort() && HostBridge.isConnected()) process.once('disconnect', handler)
  },

  /**
   * BL-46: asks the main process for the start-up secrets and waits for its first `init`
   * message. Resolves `null` when there is no parent port (standalone runs, tests), where the
   * secrets come from the environment.
   */
  receiveInit(timeoutMs = 10_000): Promise<InitSecrets | null> {
    const port = parentPort()
    if (!port) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        port.off('message', listener)
        reject(new Error('The main process did not send its start-up message'))
      }, timeoutMs)
      const listener = (event: { data: unknown }): void => {
        const init = parseInit(event.data)
        if (!init) return
        clearTimeout(timer)
        port.off('message', listener)
        resolve(init)
      }
      port.on('message', listener)
      port.postMessage({ type: 'ready' })
    })
  }
}
