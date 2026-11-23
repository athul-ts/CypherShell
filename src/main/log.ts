/**
 * The main process log, app.log (BL-43). No Electron imports: the path is passed in,
 * so everything here is unit-tested.
 *
 *  - The previous runs are kept as app.log.1 and app.log.2 instead of being overwritten,
 *    so the log of a crashed run survives the restart.
 *  - A run's log is capped: it rotates once it would exceed MAX_LOG_BYTES.
 *  - Error reports from the renderer are validated, size-limited and rate-limited here.
 */
import { appendFileSync, existsSync, renameSync, rmSync } from 'fs'

export const MAX_LOG_BYTES = 5 * 1024 * 1024
const KEPT_LOGS = 2

/** Longest renderer message that is written (the rest is cut). */
export const MAX_RENDERER_MESSAGE = 2048
const MAX_RENDERER_CONTEXT = 100

/** app.log → app.log.1 → app.log.2; the oldest is dropped. Never throws. */
export function rotateLog(logPath: string): void {
  try {
    rmSync(`${logPath}.${KEPT_LOGS}`, { force: true })
    for (let i = KEPT_LOGS - 1; i >= 1; i--) {
      if (existsSync(`${logPath}.${i}`)) renameSync(`${logPath}.${i}`, `${logPath}.${i + 1}`)
    }
    if (existsSync(logPath)) renameSync(logPath, `${logPath}.1`)
  } catch {
    // A log that cannot be rotated must not stop the app.
  }
}

export class AppLog {
  private size = 0

  constructor(
    private readonly logPath: string,
    private readonly maxBytes: number = MAX_LOG_BYTES
  ) {}

  /** Rotates the previous run's log and starts a new one. */
  start(): void {
    rotateLog(this.logPath)
    this.size = 0
    this.write(`=== APP STARTUP ===`)
  }

  write(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}\n`
    const bytes = Buffer.byteLength(line)
    try {
      if (this.size + bytes > this.maxBytes) {
        rotateLog(this.logPath)
        this.size = 0
      }
      appendFileSync(this.logPath, line)
      this.size += bytes
    } catch {
      // There is nowhere else to report a failure to write the log.
    }
  }
}

/** At most `limit` calls to `allow()` per `windowMs`. */
export class RateLimiter {
  private windowStart = 0
  private count = 0

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  allow(): boolean {
    const t = this.now()
    if (this.count === 0 || t - this.windowStart >= this.windowMs) {
      this.windowStart = t
      this.count = 0
    }
    if (this.count >= this.limit) return false
    this.count++
    return true
  }
}

/**
 * A log line for a renderer error report, or `null` when the report is not a context and a
 * message. Line breaks are removed so a report cannot forge log lines.
 */
export function parseRendererError(context: unknown, message: unknown): string | null {
  if (typeof context !== 'string' || context.length === 0) return null
  if (typeof message !== 'string') return null
  const flat = (text: string): string => text.replace(/[\r\n]+/g, ' ⏎ ')
  const body =
    message.length > MAX_RENDERER_MESSAGE ? message.slice(0, MAX_RENDERER_MESSAGE) + '…' : message
  return `[Renderer] ${flat(context.slice(0, MAX_RENDERER_CONTEXT))}: ${flat(body)}`
}

/** The handler of the `log:rendererError` channel: validated, then rate-limited, then logged. */
export function createRendererErrorHandler(
  write: (line: string) => void,
  limiter: RateLimiter = new RateLimiter(20, 60_000)
): (context: unknown, message: unknown) => void {
  return (context, message) => {
    const line = parseRendererError(context, message)
    if (line && limiter.allow()) write(line)
  }
}
