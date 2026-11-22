/**
 * Grants for SFTP local files (BL-47, ADR-006). The page never sends a local path to the backend:
 * the main process issues an opaque grant for a file or folder the user chose, and the backend
 * asks main to resolve it for each transfer. No Electron or fs imports, so it is unit-tested.
 */
import { randomBytes } from 'crypto'

/** read: a file to upload. write: a file to download into. dir: a listed local-pane folder (reads only). */
export type GrantKind = 'read' | 'write' | 'dir'

export interface Grant {
  kind: GrantKind
  path: string
  windowId: number
  sessionId: string
}

const MAX_NAME = 255
const GRANT_ID = /^[0-9a-f]{32}$/

/** Windows device names, with or without an extension (COM¹ … are the superscript forms). */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i

/** True for a single file name that is safe to join onto a folder on `platform`. */
export function isAllowedLocalName(
  name: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (name.length < 1 || name.length > MAX_NAME) return false
  if (name === '.' || name === '..') return false
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f/]/.test(name)) return false
  if (platform === 'win32') {
    if (/[\\:*?"<>|]/.test(name)) return false
    if (/[. ]$/.test(name)) return false
    if (WINDOWS_DEVICE.test(name)) return false
  }
  return true
}

export class LocalGrantRegistry {
  private readonly maxPerWindow: number
  private readonly newId: () => string
  private readonly sessions = new Map<number, string>()
  /** Map order is recency: the first entry is the least recently used. */
  private readonly grants = new Map<string, Grant>()

  constructor(options: { maxPerWindow?: number; newId?: () => string } = {}) {
    this.maxPerWindow = options.maxPerWindow ?? 256
    this.newId = options.newId ?? (() => randomBytes(16).toString('hex'))
  }

  /** Marks `windowId` as an SFTP window for `sessionId`; only such windows get grants. */
  openWindow(windowId: number, sessionId: string): void {
    this.sessions.set(windowId, sessionId)
  }

  closeWindow(windowId: number): void {
    this.sessions.delete(windowId)
    for (const [id, grant] of this.grants) if (grant.windowId === windowId) this.grants.delete(id)
  }

  /** Revokes every grant and forgets every window (a lock). */
  clear(): void {
    this.sessions.clear()
    this.grants.clear()
  }

  isOpen(windowId: number): boolean {
    return this.sessions.has(windowId)
  }

  /** The SSH session an SFTP window belongs to. */
  sessionOf(windowId: number): string | undefined {
    return this.sessions.get(windowId)
  }

  issue(windowId: number, kind: GrantKind, path: string): string {
    const sessionId = this.sessions.get(windowId)
    if (sessionId === undefined) throw new Error('Not an SFTP window')

    for (const [id, grant] of this.grants) {
      if (grant.windowId === windowId && grant.kind === kind && grant.path === path) {
        this.touch(id, grant)
        return id
      }
    }
    const own = [...this.grants].filter(([, grant]) => grant.windowId === windowId)
    for (const [id] of own.slice(0, Math.max(0, own.length - this.maxPerWindow + 1))) {
      this.grants.delete(id)
    }
    const id = this.newId()
    this.grants.set(id, { kind, path, windowId, sessionId })
    return id
  }

  lookup(id: string): Grant | null {
    const grant = this.grants.get(id)
    if (!grant) return null
    this.touch(id, grant)
    return { ...grant }
  }

  private touch(id: string, grant: Grant): void {
    this.grants.delete(id)
    this.grants.set(id, grant)
  }
}

/** A request from the backend to resolve a grant (BL-47). */
export interface GrantResolveRequest {
  type: 'grant-resolve'
  requestId: string
  sessionId: string
  grant: string
  access: 'read' | 'write'
  name?: string
}

export function parseGrantResolveRequest(raw: unknown): GrantResolveRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (m.type !== 'grant-resolve') return null
  if (typeof m.requestId !== 'string' || m.requestId.length < 1 || m.requestId.length > 64)
    return null
  if (typeof m.sessionId !== 'string' || m.sessionId.length < 1) return null
  if (typeof m.grant !== 'string' || !GRANT_ID.test(m.grant)) return null
  if (m.access !== 'read' && m.access !== 'write') return null
  if (m.name !== undefined && (typeof m.name !== 'string' || m.name.length > MAX_NAME)) return null
  const request: GrantResolveRequest = {
    type: 'grant-resolve',
    requestId: m.requestId,
    sessionId: m.sessionId,
    grant: m.grant,
    access: m.access
  }
  if (m.name !== undefined) request.name = m.name
  return request
}
