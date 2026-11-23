import { EventEmitter } from 'events'
import { CryptoService } from './crypto.service'
import { TokenStore } from './token-store.service'
import { ConfigService } from './config.service'
import { logger } from './logger.service'

/** Auto-lock default before the app is configured (matches the Prisma default). */
const DEFAULT_AUTO_LOCK_MINUTES = 15

/** What the main process needs to run the idle clock (BL-18). */
export interface LockPolicy {
  enabled: boolean
  autoLockMinutes: number
}

/** Calls every listener of `event`, so one failing listener cannot skip the rest. */
function emitSafely(emitter: EventEmitter, event: string, ...args: unknown[]): void {
  for (const listener of emitter.listeners(event)) {
    try {
      ;(listener as (...a: unknown[]) => void)(...args)
    } catch (err) {
      logger.error(
        `${event} listener failed: ` + (err instanceof Error ? err.message : String(err))
      )
    }
  }
}

/**
 * Locking the app (BL-18, FR-07.5).
 *
 * A lock forgets the encryption key and revokes every issued token. Every
 * live transport subscribes through `onLock()` and closes: terminal sockets
 * and SFTP progress streams. Running tunnels and in-flight transfers are left
 * alone. `index.ts` forwards locks and policy changes to the main process,
 * which closes the connection windows and runs the idle clock.
 */
export class AppLockService {
  private static readonly events = new EventEmitter().setMaxListeners(0)

  static lock(): void {
    CryptoService.clearActiveKey()
    TokenStore.revokeAll() // SEC-06
    emitSafely(this.events, 'locked')
  }

  /** Runs `listener` after every lock. Returns a function that unsubscribes it. */
  static onLock(listener: () => void): () => void {
    this.events.on('locked', listener)
    return () => {
      this.events.off('locked', listener)
    }
  }

  /** Runs `listener` with the auto-lock policy whenever it is published. Returns an unsubscribe. */
  static onPolicy(listener: (policy: LockPolicy) => void): () => void {
    this.events.on('policy', listener)
    return () => {
      this.events.off('policy', listener)
    }
  }

  /**
   * Publishes the current auto-lock policy. Called at startup and after every
   * change to the lock mode or the timeout. Never throws.
   */
  static async publishPolicy(): Promise<void> {
    try {
      const config = await ConfigService.findConfig()
      const policy: LockPolicy = {
        enabled: config?.lockEnabled ?? false,
        autoLockMinutes: config?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES
      }
      emitSafely(this.events, 'policy', policy)
    } catch (err) {
      logger.error(
        'Could not publish the lock policy: ' + (err instanceof Error ? err.message : String(err))
      )
    }
  }
}
