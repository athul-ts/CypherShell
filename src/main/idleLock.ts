/**
 * One idle clock for the whole app (FR-07.5, BL-18).
 *
 * Every window's input resets it. When app lock is enabled and no input
 * arrives for `autoLockMinutes`, it calls `lock()` once, then waits for the
 * next input before it can fire again. The backend publishes the policy over
 * the child-process IPC channel (see `parseBackendMessage`).
 *
 * Deliberately free of Electron imports so it can be unit-tested.
 */

export interface LockPolicy {
  enabled: boolean
  autoLockMinutes: number
}

export interface IdleLockOptions {
  /** Asks the backend to lock the app. */
  lock: () => void
  /** How often the idle time is compared with the timeout. */
  checkEveryMs?: number
  /** Injection points for tests. */
  now?: () => number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

const DEFAULT_CHECK_EVERY_MS = 10_000

export class IdleLock {
  private policy: LockPolicy = { enabled: false, autoLockMinutes: 15 }
  private lastActivity: number
  private fired = false
  private handle: unknown = null
  private readonly now: () => number

  constructor(private readonly options: IdleLockOptions) {
    this.now = options.now ?? Date.now
    this.lastActivity = this.now()
  }

  /** Starts the periodic check. */
  start(): void {
    if (this.handle !== null) return
    const set =
      this.options.setInterval ??
      ((fn: () => void, ms: number): unknown => {
        const timer = setInterval(fn, ms)
        timer.unref()
        return timer
      })
    this.handle = set(() => this.check(), this.options.checkEveryMs ?? DEFAULT_CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.handle === null) return
    ;(this.options.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout)))(this.handle)
    this.handle = null
  }

  /** A policy from the backend. Changing it counts as activity, so the clock restarts. */
  setPolicy(policy: LockPolicy): void {
    this.policy = {
      enabled: policy.enabled,
      autoLockMinutes: Math.max(1, policy.autoLockMinutes)
    }
    this.recordActivity()
  }

  /** Input (key, mouse, wheel) in any window. */
  recordActivity(): void {
    this.lastActivity = this.now()
    this.fired = false
  }

  /** Locks when the app has been idle for the timeout. Returns true when it locked now. */
  check(): boolean {
    if (!this.policy.enabled || this.fired) return false
    if (this.now() - this.lastActivity < this.policy.autoLockMinutes * 60_000) return false
    this.fired = true
    this.options.lock()
    return true
  }
}

/** Messages the backend sends over the IPC channel (backend `host-bridge.service.ts`). */
export type BackendMessage = { type: 'locked' } | ({ type: 'lock-policy' } & LockPolicy)

/** Validates a message from the backend; anything malformed is ignored. */
export function parseBackendMessage(message: unknown): BackendMessage | null {
  if (typeof message !== 'object' || message === null) return null
  const m = message as Record<string, unknown>
  if (m.type === 'locked') return { type: 'locked' }
  if (
    m.type === 'lock-policy' &&
    typeof m.enabled === 'boolean' &&
    typeof m.autoLockMinutes === 'number' &&
    Number.isFinite(m.autoLockMinutes)
  ) {
    return { type: 'lock-policy', enabled: m.enabled, autoLockMinutes: m.autoLockMinutes }
  }
  return null
}
