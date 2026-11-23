import { promises as fs } from 'fs'
import path from 'path'

/** A local path that SFTP transfers must not use. The message is shown to the user. */
export class LocalPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalPathError'
  }
}

/**
 * Checks the local paths that SFTP transfers read and write (BL-23, NFR-02).
 *
 * Since BL-47 the request names a grant and the main process says which path it is
 * (`LocalGrantService`); the backend never sees a path the page sent. The paths come from the
 * native open/save dialogs, OS drops or the local pane, where the user may pick any folder, so
 * there is no base-directory restriction. This is a second line of defense: it checks that each
 * path main returned is what the transfer needs it to be: an
 * absolute, normalized path to a regular file — never a relative path
 * (which would resolve against the backend's working directory), a
 * directory, a device or a pipe.
 */
export class LocalPathService {
  /** Returns the normalized absolute form of `raw`. */
  static normalize(raw: string): string {
    if (raw.includes('\0')) throw new LocalPathError('Invalid local path')
    if (!path.isAbsolute(raw)) throw new LocalPathError('Local path must be absolute')
    return path.resolve(raw)
  }

  /** An upload source: an existing regular file. Returns the normalized path. */
  static async uploadSource(raw: string): Promise<string> {
    const filePath = this.normalize(raw)
    const stats = await fs.stat(filePath).catch(() => null)
    if (!stats) throw new LocalPathError('Local file not found')
    if (!stats.isFile()) throw new LocalPathError('Local path is not a regular file')
    return filePath
  }

  /**
   * A download target: its folder exists, and the target is either new or an
   * existing regular file (to be replaced). Returns the normalized path.
   */
  static async downloadTarget(raw: string): Promise<string> {
    const filePath = this.normalize(raw)
    const folder = await fs.stat(path.dirname(filePath)).catch(() => null)
    if (!folder?.isDirectory()) throw new LocalPathError('Download folder does not exist')
    const existing = await fs.lstat(filePath).catch(() => null)
    if (existing && !existing.isFile()) {
      throw new LocalPathError('Download target is not a regular file')
    }
    return filePath
  }
}
