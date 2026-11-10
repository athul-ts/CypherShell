import type { ChildProcess } from 'child_process'

export interface BackendSupervisorOptions {
  /** Starts the backend process. Called again for every restart. */
  spawn: () => ChildProcess
  /** Called right after a restart has been spawned, with the restart number. */
  onRestart?: (restart: number) => void
  /** Called once when the supervisor stops restarting after repeated failures. */
  onGiveUp?: (failures: number) => void
  log?: (message: string) => void
  /** Delay before each successive restart (the last value repeats). */
  backoffMs?: number[]
  /** Stop restarting once this many unexpected exits happen within `windowMs`. */
  maxFailures?: number
  windowMs?: number
  /** Injection points for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => number
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000]
const DEFAULT_MAX_FAILURES = 5
const DEFAULT_WINDOW_MS = 2 * 60 * 1000

/**
 * Keeps the backend child process running (NFR-03, BL-16).
 *
 * An exit while the app is running is treated as a crash and the backend is
 * restarted with growing delays. After `maxFailures` crashes within
 * `windowMs` it gives up rather than looping. Exits after `stop()` — the app
 * quitting — are expected and never restarted.
 *
 * Deliberately free of Electron imports so it can be unit-tested.
 */
export class BackendSupervisor {
  private child: ChildProcess | null = null
  private stopped = false
  private failureTimes: number[] = []
  private restartHandle: unknown = null
  private restarts = 0

  constructor(private readonly options: BackendSupervisorOptions) {}

  /** The current backend process, or null between a crash and its restart. */
  get process(): ChildProcess | null {
    return this.child
  }

  start(): ChildProcess {
    this.stopped = false
    return this.launch()
  }

  /** Stops supervising: the next exit (e.g. from killing it on quit) is expected. */
  stop(): void {
    this.stopped = true
    if (this.restartHandle !== null) {
      ;(this.options.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.restartHandle)
      this.restartHandle = null
    }
  }

  private launch(): ChildProcess {
    const child = this.options.spawn()
    this.child = child
    child.once('exit', (code, signal) => this.handleExit(child, code, signal))
    return child
  }

  private handleExit(child: ChildProcess, code: number | null, signal: string | null): void {
    if (child !== this.child) return // an older process; already handled
    this.child = null
    if (this.stopped) return

    const now = (this.options.now ?? Date.now)()
    const windowMs = this.options.windowMs ?? DEFAULT_WINDOW_MS
    this.failureTimes = this.failureTimes.filter((t) => now - t < windowMs)
    this.failureTimes.push(now)

    const maxFailures = this.options.maxFailures ?? DEFAULT_MAX_FAILURES
    if (this.failureTimes.length >= maxFailures) {
      this.options.log?.(
        `Backend exited ${this.failureTimes.length} times within ${windowMs / 1000}s; not restarting.`
      )
      this.options.onGiveUp?.(this.failureTimes.length)
      return
    }

    const backoff = this.options.backoffMs ?? DEFAULT_BACKOFF_MS
    const delay = backoff[Math.min(this.failureTimes.length - 1, backoff.length - 1)]
    this.options.log?.(
      `Backend exited unexpectedly (code ${code}, signal ${signal}); restarting in ${delay} ms`
    )
    const setTimer = this.options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.restartHandle = setTimer(() => {
      this.restartHandle = null
      if (this.stopped) return
      this.launch()
      this.restarts++
      this.options.onRestart?.(this.restarts)
    }, delay)
  }
}
