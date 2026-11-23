/**
 * Terminal and SFTP windows (FR-02.9, SEC-07, BL-20): their route and the
 * one-time JWT hand-off. The token never appears in a window URL.
 *
 * Deliberately free of Electron imports so it can be unit-tested.
 */

export type ConnectionWindowType = 'terminal' | 'sftp'

export interface ConnectionWindowRequest {
  sessionId: string
  profileId: string
  title: string
  /** The main window's JWT; empty when it has none (the new window then re-authenticates). */
  token: string
}

/** Session ids are `session-<uuid>`, profile ids cuids. */
const ID = /^[A-Za-z0-9_-]{1,128}$/

/** Validates the renderer's `openTerminalWindow` / `openSftpWindow` arguments. */
export function parseConnectionWindowRequest(raw: unknown): ConnectionWindowRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { sessionId, profileId, title, token } = raw as Record<string, unknown>
  if (typeof sessionId !== 'string' || !ID.test(sessionId)) return null
  if (typeof profileId !== 'string' || !ID.test(profileId)) return null
  if (typeof token !== 'string' || token.length > 4096) return null
  return {
    sessionId,
    profileId,
    title: typeof title === 'string' ? title.slice(0, 200) : '',
    token
  }
}

/** The hash route a connection window loads. It carries no credential. */
export function connectionWindowRoute(
  type: ConnectionWindowType,
  sessionId: string,
  profileId: string
): string {
  return `/connection/${type}/${encodeURIComponent(sessionId)}?profileId=${encodeURIComponent(profileId)}`
}

export interface TokenBrokerOptions {
  /** How long an unclaimed token is kept. */
  ttlMs?: number
  /** Injection points for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/**
 * Holds each new connection window's JWT until that window asks for it,
 * once. Keyed by the window's `webContents.id`, so no other window — and no
 * second claim — gets it.
 */
export class ConnectionTokenBroker {
  private readonly pending = new Map<number, { token: string; timer: unknown }>()

  constructor(private readonly options: TokenBrokerOptions = {}) {}

  offer(windowId: number, token: string): void {
    this.forget(windowId)
    const set =
      this.options.setTimer ??
      ((fn: () => void, ms: number): unknown => {
        const timer = setTimeout(fn, ms)
        timer.unref()
        return timer
      })
    const timer = set(() => this.pending.delete(windowId), this.options.ttlMs ?? 30_000)
    this.pending.set(windowId, { token, timer })
  }

  /** Returns the window's token and forgets it, or null. */
  claim(windowId: number): string | null {
    const entry = this.pending.get(windowId)
    if (!entry) return null
    this.forget(windowId)
    return entry.token
  }

  /** Drops an unclaimed token (the window closed first). */
  forget(windowId: number): void {
    const entry = this.pending.get(windowId)
    if (!entry) return
    ;(this.options.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(entry.timer)
    this.pending.delete(windowId)
  }
}
