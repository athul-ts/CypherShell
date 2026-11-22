/**
 * Main's local-file functions for the SFTP window (BL-47, ADR-006): the local-pane listing and
 * its policy, the native dialogs and OS drops that issue grants, and grant resolution for the
 * backend. Dialogs are injected and the file system is replaceable, so everything here is
 * unit-tested. No Electron imports.
 */
import fsp from 'fs/promises'
import path from 'path'
import { LocalGrantRegistry, isAllowedLocalName, type GrantResolveRequest } from './localGrants'

export type LocalFileErrorCode =
  | 'GRANT_UNKNOWN'
  | 'GRANT_MISMATCH'
  | 'NAME_NOT_ALLOWED'
  | 'REFUSED'
  | 'NOT_FOUND'
  | 'NOT_A_FILE'

export class LocalFileError extends Error {
  constructor(
    readonly code: LocalFileErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'LocalFileError'
  }
}

export type GrantResolution = { ok: true; path: string } | { ok: false; code: LocalFileErrorCode }

/** The file-system calls this module makes; `fs/promises` by default. */
export type LocalFs = Pick<typeof fsp, 'realpath' | 'stat' | 'readdir'>

export interface LocalDialogs {
  open(
    windowId: number,
    options: { properties: string[] }
  ): Promise<{ canceled: boolean; filePaths: string[] }>
  save(
    windowId: number,
    options: { defaultPath?: string; properties: string[] }
  ): Promise<{ canceled: boolean; filePath?: string }>
}

export interface LocalPanePolicy {
  /** The home folder as a native real path. */
  home: string
  /** Folders the local pane refuses, as native real paths. */
  refused: string[]
  platform: NodeJS.Platform
  fs: LocalFs
}

export interface LocalFilesContext {
  registry: LocalGrantRegistry
  policy: LocalPanePolicy
  dialogs: LocalDialogs
}

export interface LocalDirEntry {
  name: string
  type: 'd' | 'f'
  size: number
  modifyTime: string
  permissions: number
}

export interface LocalDirListing {
  path: string
  parent: string | null
  grant: string
  files: LocalDirEntry[]
}

export interface PickedLocalFile {
  grant: string
  name: string
}

const pathFor = (platform: NodeJS.Platform): path.PlatformPath =>
  platform === 'win32' ? path.win32 : path.posix

/** Windows device paths (`\\.\pipe\x`, `\\?\C:\x`): a `stat` on one can connect to a pipe. */
export function isDevicePath(p: string): boolean {
  return /^[\\/]{2}[.?][\\/]/.test(p)
}

/** True when `target` is `base` or inside it. Case-insensitive on Windows and macOS. */
export function isWithin(base: string, target: string, platform: NodeJS.Platform): boolean {
  const P = pathFor(platform)
  const fold = (value: string): string =>
    platform === 'darwin' ? value.normalize('NFC').toLowerCase() : value
  const rel = P.relative(fold(base), fold(target))
  return rel === '' || (!rel.startsWith('..') && !P.isAbsolute(rel))
}

/** The name a download is suggested under: no folders, nothing the platform would reject. */
export function safeDownloadName(
  name: string,
  platform: NodeJS.Platform = process.platform
): string {
  const last = name.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  let clean = last.replace(/[\x00-\x1f\x7f]/g, '')
  if (platform === 'win32') {
    clean = clean.replace(/[:*?"<>|]/g, '_').replace(/[. ]+$/, '')
    if (!isAllowedLocalName(clean, platform) && clean.length > 0) clean = `_${clean}`
  }
  if (clean === '.' || clean === '..' || clean === '') return 'download'
  return clean.slice(0, 255)
}

export async function createLocalPanePolicy(options: {
  home: string
  refused: string[]
  platform?: NodeJS.Platform
  fs?: LocalFs
}): Promise<LocalPanePolicy> {
  const fs = options.fs ?? fsp
  // The native real path expands 8.3 names, fixes case and follows junctions and symlinks.
  const real = async (p: string): Promise<string> => {
    try {
      return await fs.realpath(p)
    } catch {
      return path.resolve(p) // a folder that does not exist yet is still refused by name
    }
  }
  return {
    home: await real(options.home),
    refused: await Promise.all(options.refused.map(real)),
    platform: options.platform ?? process.platform,
    fs
  }
}

const insideHome = (policy: LocalPanePolicy, real: string): boolean =>
  isWithin(policy.home, real, policy.platform) &&
  !policy.refused.some((folder) => isWithin(folder, real, policy.platform))

const requireSftpWindow = (ctx: LocalFilesContext, windowId: number): void => {
  if (!ctx.registry.isOpen(windowId)) throw new LocalFileError('REFUSED', 'Not an SFTP window')
}

const isPlainPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !value.includes('\0')

/** The local-pane listing (FR-04.2): under the home folder, never inside a refused folder. */
export async function readLocalDir(
  ctx: LocalFilesContext,
  windowId: number,
  raw?: unknown
): Promise<LocalDirListing> {
  requireSftpWindow(ctx, windowId)
  const { policy } = ctx
  let wanted = policy.home
  if (raw !== undefined && raw !== '' && raw !== '.') {
    if (!isPlainPath(raw) || isDevicePath(raw) || !path.isAbsolute(raw)) {
      throw new LocalFileError(
        'REFUSED',
        'Only absolute folders under your home folder can be listed'
      )
    }
    wanted = raw
  }
  let real: string
  try {
    real = await policy.fs.realpath(wanted)
  } catch {
    throw new LocalFileError('NOT_FOUND', 'Folder not found')
  }
  if (!insideHome(policy, real)) {
    throw new LocalFileError('REFUSED', 'This folder cannot be shown')
  }
  const info = await policy.fs.stat(real).catch(() => null)
  if (!info?.isDirectory()) throw new LocalFileError('REFUSED', 'Not a folder')

  const names = await policy.fs.readdir(real)
  const entries = await Promise.all(
    names.map(async (name): Promise<LocalDirEntry | null> => {
      try {
        const s = await policy.fs.stat(path.join(real, name)) // follows symlinks
        return {
          name,
          type: s.isDirectory() ? 'd' : 'f',
          size: s.size,
          modifyTime: s.mtime.toISOString(),
          permissions: s.mode
        }
      } catch {
        return null // a broken link or a file that vanished
      }
    })
  )
  const atHome = isWithin(real, policy.home, policy.platform) // real is home itself
  return {
    path: real,
    parent: atHome ? null : path.dirname(real),
    grant: ctx.registry.issue(windowId, 'dir', real),
    files: entries.filter((e): e is LocalDirEntry => e !== null)
  }
}

/** The Upload button: the native Open dialog; returns a grant and the name, never the path. */
export async function pickUploadFile(
  ctx: LocalFilesContext,
  windowId: number
): Promise<PickedLocalFile | null> {
  requireSftpWindow(ctx, windowId)
  const { canceled, filePaths } = await ctx.dialogs.open(windowId, { properties: ['openFile'] })
  const picked = filePaths[0]
  if (canceled || !picked || !path.isAbsolute(picked)) return null
  const info = await ctx.policy.fs.stat(picked).catch(() => null)
  if (!info?.isFile()) return null
  return { grant: ctx.registry.issue(windowId, 'read', picked), name: path.basename(picked) }
}

/**
 * The Download button, and a remote file dropped on the local pane: the native Save dialog with
 * a cleaned name, in the folder of this window's folder grant when one is given.
 */
export async function pickDownloadTarget(
  ctx: LocalFilesContext,
  windowId: number,
  request: unknown
): Promise<PickedLocalFile | null> {
  requireSftpWindow(ctx, windowId)
  if (typeof request !== 'object' || request === null) {
    throw new LocalFileError('REFUSED', 'Invalid request')
  }
  const { name, folder } = request as { name?: unknown; folder?: unknown }
  if (typeof name !== 'string') throw new LocalFileError('REFUSED', 'Invalid request')

  const clean = safeDownloadName(name, ctx.policy.platform)
  let defaultPath = clean
  const grant = typeof folder === 'string' ? ctx.registry.lookup(folder) : null
  if (grant && grant.kind === 'dir' && grant.windowId === windowId) {
    defaultPath = path.join(grant.path, clean)
  }
  const { canceled, filePath } = await ctx.dialogs.save(windowId, {
    defaultPath,
    properties: ['showOverwriteConfirmation', 'createDirectory']
  })
  if (canceled || !filePath || !path.isAbsolute(filePath)) return null
  return { grant: ctx.registry.issue(windowId, 'write', filePath), name: path.basename(filePath) }
}

/** A file dropped from the OS. The path comes from the preload's `webUtils`, not from the page. */
export async function grantDroppedFile(
  ctx: LocalFilesContext,
  windowId: number,
  raw: unknown
): Promise<PickedLocalFile | null> {
  requireSftpWindow(ctx, windowId)
  if (!isPlainPath(raw) || isDevicePath(raw) || !path.isAbsolute(raw)) return null
  const info = await ctx.policy.fs.stat(raw).catch(() => null)
  if (!info?.isFile()) return null
  return { grant: ctx.registry.issue(windowId, 'read', raw), name: path.basename(raw) }
}

const refuse = (code: LocalFileErrorCode): GrantResolution => ({ ok: false, code })

/** Resolves a backend request to the local path it names, or says why not (ADR-006). */
export async function resolveGrantRequest(
  ctx: LocalFilesContext,
  request: GrantResolveRequest
): Promise<GrantResolution> {
  const grant = ctx.registry.lookup(request.grant)
  if (!grant) return refuse('GRANT_UNKNOWN')
  if (grant.sessionId !== request.sessionId) return refuse('GRANT_MISMATCH')
  const { policy } = ctx

  if (grant.kind !== 'dir') {
    if (request.access !== grant.kind || request.name !== undefined) return refuse('GRANT_MISMATCH')
    if (grant.kind === 'write') return { ok: true, path: grant.path }
    const info = await policy.fs.stat(grant.path).catch(() => null)
    if (!info) return refuse('NOT_FOUND')
    return info.isFile() ? { ok: true, path: grant.path } : refuse('NOT_A_FILE')
  }

  // A folder grant serves reads of one file directly inside the folder, by name.
  if (request.access !== 'read') return refuse('GRANT_MISMATCH')
  const name = request.name
  if (name === undefined || !isAllowedLocalName(name, policy.platform)) {
    return refuse('NAME_NOT_ALLOWED')
  }
  const folder = await policy.fs.realpath(grant.path).catch(() => null)
  if (folder === null) return refuse('NOT_FOUND')
  if (folder !== grant.path) return refuse('REFUSED') // the folder was replaced since the listing

  const target = path.join(grant.path, name)
  const rel = path.relative(grant.path, target)
  if (rel !== name || rel.startsWith('..') || path.isAbsolute(rel))
    return refuse('NAME_NOT_ALLOWED')

  const real = await policy.fs.realpath(target).catch(() => null)
  if (real === null) return refuse('NOT_FOUND')
  if (!insideHome(policy, real)) return refuse('REFUSED')
  const info = await policy.fs.stat(real).catch(() => null)
  if (!info?.isFile()) return refuse('NOT_A_FILE')
  return { ok: true, path: real }
}
