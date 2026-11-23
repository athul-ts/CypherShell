/**
 * Local files in the SFTP window (BL-47, ADR-006). The page never holds a local path it could
 * send to the backend: it holds grants that the main process issued. Drag payloads between the
 * panes carry a grant and a name, and are parsed defensively because a drag can come from
 * anywhere.
 */

/** The drag type of a row in the local pane: `{ grant, name }`. A `text/plain` drag is never trusted. */
export const LOCAL_FILE_MIME = 'application/x-cyphershell-local'

/** The drag type of a row in the remote pane: `{ filename, remotePath, size }`. */
export const REMOTE_FILE_MIME = 'application/x-remote-file'

/** What the backend is sent to name a local file (see `POST /api/sftp/:id/upload`). */
export interface LocalFileRef {
  grant: string
  name?: string
}

const GRANT_ID = /^[0-9a-f]{32}$/
const MAX_NAME = 255

type DragData = Pick<DataTransfer, 'getData'>

function parseJson(text: string): Record<string, unknown> | null {
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function localFileDragPayload(grant: string, name: string): string {
  return JSON.stringify({ grant, name })
}

/** A file dragged out of the local pane, or null for anything else. */
export function readLocalFileDrag(dt: DragData): { grant: string; name: string } | null {
  const data = parseJson(dt.getData(LOCAL_FILE_MIME))
  if (!data) return null
  const { grant, name } = data
  if (typeof grant !== 'string' || !GRANT_ID.test(grant)) return null
  if (typeof name !== 'string' || name.length < 1 || name.length > MAX_NAME) return null
  return { grant, name }
}

/** A file dragged out of the remote pane, or null for anything else. */
export function readRemoteFileDrag(
  dt: DragData
): { filename: string; remotePath: string; size: number } | null {
  const data = parseJson(dt.getData(REMOTE_FILE_MIME))
  if (!data) return null
  const { filename, remotePath, size } = data
  if (typeof filename !== 'string' || filename.length === 0) return null
  if (typeof remotePath !== 'string' || remotePath.length === 0) return null
  if (typeof size !== 'number' || !Number.isFinite(size)) return null
  return { filename, remotePath, size }
}
