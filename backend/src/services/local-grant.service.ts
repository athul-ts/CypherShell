import {
  HostBridge,
  type GrantErrorCode,
  type GrantReply,
  type GrantResolveInput
} from './host-bridge.service'

/**
 * A grant could not be resolved (BL-47). The controllers answer `400 { error, code }`, or `503`
 * when the main process could not be asked.
 */
export class LocalGrantError extends Error {
  readonly status: 400 | 503

  constructor(readonly code: GrantErrorCode) {
    super(MESSAGES[code])
    this.name = 'LocalGrantError'
    this.status = code === 'UNAVAILABLE' ? 503 : 400
  }
}

const MESSAGES: Record<GrantErrorCode, string> = {
  GRANT_UNKNOWN: 'This file is no longer available to this window. Pick it again.',
  GRANT_MISMATCH: 'This file cannot be used for this transfer.',
  NAME_NOT_ALLOWED: 'That file name is not allowed.',
  REFUSED: 'This file cannot be used.',
  NOT_FOUND: 'Local file not found',
  NOT_A_FILE: 'Local path is not a regular file',
  UNAVAILABLE: 'The app could not check the file. Try again.'
}

export type GrantResolver = (request: GrantResolveInput) => Promise<GrantReply>

let resolver: GrantResolver = (request) => HostBridge.resolveLocalGrant(request)

/**
 * The backend takes no local path from a request (ADR-006): it names a grant, and the main
 * process says which path that is. Never build a path from `local.name` or from the request here.
 */
export const LocalGrantService = {
  async resolve(
    sessionId: string,
    local: { grant: string; name?: string },
    access: 'read' | 'write'
  ): Promise<string> {
    const request: GrantResolveInput = { sessionId, grant: local.grant, access }
    if (local.name !== undefined) request.name = local.name
    const reply = await resolver(request)
    if (!reply.ok) throw new LocalGrantError(reply.code)
    return reply.path
  },

  /** For tests only: replaces the call to the main process. Returns a function that restores it. */
  useResolver(fn: GrantResolver): () => void {
    const previous = resolver
    resolver = fn
    return () => {
      resolver = previous
    }
  }
}
