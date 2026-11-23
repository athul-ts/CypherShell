/**
 * [NFR-02][BL-47] Main's local-file functions: the local-pane listing and policy, the native
 * dialogs and OS drops that issue grants, and grant resolution. Real temporary folders;
 * dialogs are injected. `src/main/localFiles.ts` has no Electron imports.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { LocalGrantRegistry, type GrantResolveRequest } from '../../src/main/localGrants'
import {
  createLocalPanePolicy,
  grantDroppedFile,
  isDevicePath,
  isWithin,
  pickDownloadTarget,
  pickUploadFile,
  readLocalDir,
  resolveGrantRequest,
  safeDownloadName,
  type LocalFilesContext
} from '../../src/main/localFiles'

let root: string
let home: string
let appData: string
let outside: string
let registry: LocalGrantRegistry
let opened: unknown[]
let saved: unknown[]
let openResult: { canceled: boolean; filePaths: string[] }
let saveResult: { canceled: boolean; filePath?: string }
let ctx: LocalFilesContext

const WIN = process.platform === 'win32'
const mk = (...p: string[]): string => path.join(root, ...p)
const write = (p: string, text = 'x'): string => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
  return p
}

beforeEach(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-local-')))
  home = mk('home')
  appData = mk('home', 'AppData', 'cyphershell')
  outside = mk('outside')
  for (const d of [home, appData, outside]) fs.mkdirSync(d, { recursive: true })
  registry = new LocalGrantRegistry()
  registry.openWindow(1, 'sess-1')
  registry.openWindow(2, 'sess-2')
  opened = []
  saved = []
  openResult = { canceled: true, filePaths: [] }
  saveResult = { canceled: true }
  ctx = {
    registry,
    policy: await createLocalPanePolicy({ home, refused: [appData] }),
    dialogs: {
      open: async (windowId, options) => {
        opened.push({ windowId, options })
        return openResult
      },
      save: async (windowId, options) => {
        saved.push({ windowId, options })
        return saveResult
      }
    }
  }
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('[BL-47] isWithin and isDevicePath', () => {
  it('counts the folder itself and anything below it', () => {
    expect(isWithin('/a/b', '/a/b', 'linux')).toBe(true)
    expect(isWithin('/a/b', '/a/b/c/d', 'linux')).toBe(true)
    expect(isWithin('/a/b', '/a/bc', 'linux')).toBe(false)
    expect(isWithin('/a/b', '/a', 'linux')).toBe(false)
    expect(isWithin('/a/b', '/a/b/../c', 'linux')).toBe(false)
  })

  it('ignores case on Windows and macOS only', () => {
    expect(isWithin('C:\\Users\\Me', 'c:\\users\\me\\x', 'win32')).toBe(true)
    expect(isWithin('/Users/Me', '/users/me/x', 'darwin')).toBe(true)
    expect(isWithin('/home/Me', '/home/me/x', 'linux')).toBe(false)
  })

  it('recognises Windows device paths in both slash styles', () => {
    for (const p of ['\\\\.\\pipe\\x', '//./pipe/x', '\\\\?\\C:\\x', '//?/C:/x']) {
      expect(isDevicePath(p)).toBe(true)
    }
    for (const p of ['C:\\x', '/tmp/x', '\\\\server\\share\\x']) expect(isDevicePath(p)).toBe(false)
  })
})

describe('[BL-47] safeDownloadName', () => {
  it('keeps a clean name', () => {
    expect(safeDownloadName('report.pdf', 'win32')).toBe('report.pdf')
  })

  it('drops folders written with either separator', () => {
    expect(safeDownloadName('a/b/c.txt', 'linux')).toBe('c.txt')
    expect(safeDownloadName('..\\..\\evil.txt', 'win32')).toBe('evil.txt')
    expect(safeDownloadName('..\\..\\evil.txt', 'linux')).toBe('evil.txt')
  })

  it('cleans what Windows would reject', () => {
    expect(safeDownloadName('a:b*c?.txt', 'win32')).toBe('a_b_c_.txt')
    expect(safeDownloadName('name.', 'win32')).toBe('name')
    expect(safeDownloadName('CON', 'win32')).toBe('_CON')
    expect(safeDownloadName('nul.txt', 'win32')).toBe('_nul.txt')
  })

  it('falls back to "download" and caps the length', () => {
    expect(safeDownloadName('..', 'linux')).toBe('download')
    expect(safeDownloadName('', 'linux')).toBe('download')
    expect(safeDownloadName('\0\n', 'linux')).toBe('download')
    expect(safeDownloadName('x'.repeat(400), 'linux')).toHaveLength(255)
  })
})

describe('[BL-47] readLocalDir', () => {
  it('lists the home folder for an empty, missing or "." path, and issues a dir grant', async () => {
    write(path.join(home, 'a.txt'), 'hello')
    fs.mkdirSync(path.join(home, 'sub'))
    for (const raw of [undefined, '', '.']) {
      const result = await readLocalDir(ctx, 1, raw)
      expect(result.path).toBe(home)
      expect(result.parent).toBeNull()
      expect(result.grant).toMatch(/^[0-9a-f]{32}$/)
      const byName = Object.fromEntries(result.files.map((f) => [f.name, f]))
      expect(byName['a.txt']).toMatchObject({ type: 'f', size: 5 })
      expect(byName['sub'].type).toBe('d')
    }
    const grant = registry.lookup((await readLocalDir(ctx, 1)).grant)
    expect(grant).toMatchObject({ kind: 'dir', path: home, windowId: 1 })
  })

  it('goes into a sub folder and reports its parent', async () => {
    write(path.join(home, 'sub', 'deep', 'f.txt'))
    const result = await readLocalDir(ctx, 1, path.join(home, 'sub', 'deep'))
    expect(result.path).toBe(path.join(home, 'sub', 'deep'))
    expect(result.parent).toBe(path.join(home, 'sub'))
    expect((await readLocalDir(ctx, 1, result.parent as string)).parent).toBe(home)
  })

  it('shows a symlinked folder as a folder', async () => {
    fs.mkdirSync(path.join(home, 'real'))
    fs.symlinkSync(path.join(home, 'real'), path.join(home, 'link'), 'junction')
    const files = (await readLocalDir(ctx, 1)).files
    expect(files.find((f) => f.name === 'link')?.type).toBe('d')
  })

  it.each([
    ['a relative path', () => 'Documents'],
    ['a path above home', () => path.dirname(home)],
    ['a sibling of home', () => outside],
    ['a path with a NUL byte', () => `${home}\0x`],
    ['a device path', () => (WIN ? '\\\\.\\pipe\\x' : '//./pipe/x')]
  ])('refuses %s', async (_label, raw) => {
    await expect(readLocalDir(ctx, 1, raw())).rejects.toMatchObject({ code: 'REFUSED' })
  })

  it('refuses a non-string path', async () => {
    await expect(readLocalDir(ctx, 1, 42 as never)).rejects.toMatchObject({ code: 'REFUSED' })
  })

  it('refuses the app data folder and everything inside it', async () => {
    write(path.join(appData, 'secrets', 'storage-key'))
    await expect(readLocalDir(ctx, 1, appData)).rejects.toMatchObject({ code: 'REFUSED' })
    await expect(readLocalDir(ctx, 1, path.join(appData, 'secrets'))).rejects.toMatchObject({
      code: 'REFUSED'
    })
  })

  it('refuses the app data folder through a link into it', async () => {
    fs.symlinkSync(appData, path.join(home, 'sneaky'), 'junction')
    await expect(readLocalDir(ctx, 1, path.join(home, 'sneaky'))).rejects.toMatchObject({
      code: 'REFUSED'
    })
  })

  it('refuses a link that leaves the home folder', async () => {
    fs.symlinkSync(outside, path.join(home, 'out'), 'junction')
    await expect(readLocalDir(ctx, 1, path.join(home, 'out'))).rejects.toMatchObject({
      code: 'REFUSED'
    })
  })

  it.runIf(WIN)('refuses the app data folder written in another letter case', async () => {
    await expect(readLocalDir(ctx, 1, appData.toUpperCase())).rejects.toMatchObject({
      code: 'REFUSED'
    })
  })

  it('reports a missing folder and a file as such', async () => {
    write(path.join(home, 'f.txt'))
    await expect(readLocalDir(ctx, 1, path.join(home, 'nope'))).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    await expect(readLocalDir(ctx, 1, path.join(home, 'f.txt'))).rejects.toMatchObject({
      code: 'REFUSED'
    })
  })

  it('serves only SFTP windows', async () => {
    await expect(readLocalDir(ctx, 99)).rejects.toMatchObject({ code: 'REFUSED' })
  })
})

describe('[BL-47] pickUploadFile', () => {
  it('returns a read grant and the file name, never the path', async () => {
    const file = write(path.join(outside, 'photo.png'), 'img')
    openResult = { canceled: false, filePaths: [file] }
    const picked = await pickUploadFile(ctx, 1)
    expect(picked).toEqual({ grant: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'photo.png' })
    expect(registry.lookup(picked!.grant)).toMatchObject({ kind: 'read', path: file, windowId: 1 })
    expect(JSON.stringify(picked)).not.toContain(outside)
    expect(opened).toEqual([{ windowId: 1, options: { properties: ['openFile'] } }])
  })

  it('returns null when the dialog is cancelled or picks a folder', async () => {
    expect(await pickUploadFile(ctx, 1)).toBeNull()
    openResult = { canceled: false, filePaths: [outside] }
    expect(await pickUploadFile(ctx, 1)).toBeNull()
    openResult = { canceled: false, filePaths: [] }
    expect(await pickUploadFile(ctx, 1)).toBeNull()
  })

  it('is refused for a window that is not an SFTP window', async () => {
    await expect(pickUploadFile(ctx, 99)).rejects.toMatchObject({ code: 'REFUSED' })
    expect(opened).toHaveLength(0)
  })
})

describe('[BL-47] pickDownloadTarget', () => {
  it('opens the Save dialog with the cleaned name and returns a write grant', async () => {
    const target = path.join(outside, 'saved.bin')
    saveResult = { canceled: false, filePath: target }
    const picked = await pickDownloadTarget(ctx, 1, { name: '..\\..\\saved.bin' })
    expect(picked).toEqual({ grant: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'saved.bin' })
    expect(registry.lookup(picked!.grant)).toMatchObject({ kind: 'write', path: target })
    const options = (saved[0] as { options: { defaultPath: string; properties: string[] } }).options
    expect(options.defaultPath).toBe('saved.bin')
    expect(options.properties).toEqual(
      expect.arrayContaining(['showOverwriteConfirmation', 'createDirectory'])
    )
  })

  it("starts in the folder of this window's folder grant", async () => {
    const { grant } = await readLocalDir(ctx, 1, home)
    saveResult = { canceled: true }
    await pickDownloadTarget(ctx, 1, { name: 'x.txt', folder: grant })
    const options = (saved[0] as { options: { defaultPath: string } }).options
    expect(options.defaultPath).toBe(path.join(home, 'x.txt'))
  })

  it("ignores another window's folder grant and a grant that is not a folder", async () => {
    const other = (await readLocalDir(ctx, 2, home)).grant
    await pickDownloadTarget(ctx, 1, { name: 'x.txt', folder: other })
    const file = write(path.join(outside, 'f'))
    const read = registry.issue(1, 'read', file)
    await pickDownloadTarget(ctx, 1, { name: 'x.txt', folder: read })
    for (const call of saved as { options: { defaultPath: string } }[]) {
      expect(call.options.defaultPath).toBe('x.txt')
    }
  })

  it('returns null when cancelled, and rejects a malformed request', async () => {
    expect(await pickDownloadTarget(ctx, 1, { name: 'x' })).toBeNull()
    await expect(pickDownloadTarget(ctx, 1, null as never)).rejects.toMatchObject({
      code: 'REFUSED'
    })
    await expect(pickDownloadTarget(ctx, 1, { name: 5 } as never)).rejects.toMatchObject({
      code: 'REFUSED'
    })
  })

  it('refuses a saved path that is not absolute', async () => {
    saveResult = { canceled: false, filePath: 'relative.txt' }
    expect(await pickDownloadTarget(ctx, 1, { name: 'x' })).toBeNull()
  })
})

describe('[BL-47] grantDroppedFile', () => {
  it('grants a regular file anywhere, even in the app data folder the pane refuses', async () => {
    const file = write(path.join(appData, 'dropped.txt'))
    const granted = await grantDroppedFile(ctx, 1, file)
    expect(granted).toEqual({ grant: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'dropped.txt' })
    expect(registry.lookup(granted!.grant)).toMatchObject({ kind: 'read', path: file })
  })

  it.each([
    ['a folder', () => outside],
    ['a missing file', () => path.join(outside, 'nope')],
    ['a relative path', () => 'file.txt'],
    ['an empty path', () => ''],
    ['a NUL byte', () => `${outside}\0x`],
    ['a Windows device path', () => '\\\\.\\pipe\\x'],
    ['a long-path device prefix', () => '//?/C:/x'],
    ['a non-string', () => 5 as never]
  ])('returns null for %s', async (_label, raw) => {
    expect(await grantDroppedFile(ctx, 1, raw())).toBeNull()
  })

  it('does not touch the file system for a device path', async () => {
    let touched = false
    const spying: LocalFilesContext = {
      ...ctx,
      policy: {
        ...ctx.policy,
        fs: new Proxy(ctx.policy.fs, {
          get(target, prop, receiver) {
            touched = true
            return Reflect.get(target, prop, receiver)
          }
        })
      }
    }
    await grantDroppedFile(spying, 1, '\\\\.\\pipe\\x')
    await grantDroppedFile(spying, 1, '//?/C:/x')
    expect(touched).toBe(false)
  })

  it('is refused for a window that is not an SFTP window', async () => {
    const file = write(path.join(outside, 'f'))
    await expect(grantDroppedFile(ctx, 99, file)).rejects.toMatchObject({ code: 'REFUSED' })
  })
})

describe('[BL-47] resolveGrantRequest', () => {
  const req = (grant: string, extra: Record<string, unknown> = {}): GrantResolveRequest => ({
    type: 'grant-resolve' as const,
    requestId: 'r1',
    sessionId: 'sess-1',
    grant,
    access: 'read' as const,
    ...extra
  })

  it('resolves a read grant for its session', async () => {
    const file = write(path.join(outside, 'up.txt'))
    const id = registry.issue(1, 'read', file)
    expect(await resolveGrantRequest(ctx, req(id))).toEqual({ ok: true, path: file })
  })

  it('resolves a write grant for write access', async () => {
    const target = path.join(outside, 'down.bin')
    const id = registry.issue(1, 'write', target)
    expect(await resolveGrantRequest(ctx, req(id, { access: 'write' }))).toEqual({
      ok: true,
      path: target
    })
  })

  it('refuses an unknown grant', async () => {
    expect(await resolveGrantRequest(ctx, req('0'.repeat(32)))).toEqual({
      ok: false,
      code: 'GRANT_UNKNOWN'
    })
  })

  it("refuses another session's request", async () => {
    const file = write(path.join(outside, 'f'))
    const id = registry.issue(1, 'read', file)
    expect(await resolveGrantRequest(ctx, req(id, { sessionId: 'sess-2' }))).toEqual({
      ok: false,
      code: 'GRANT_MISMATCH'
    })
  })

  it('refuses the wrong access for the kind, in both directions', async () => {
    const file = write(path.join(outside, 'f'))
    const read = registry.issue(1, 'read', file)
    const write_ = registry.issue(1, 'write', path.join(outside, 'g'))
    const dir = registry.issue(1, 'dir', outside)
    expect(await resolveGrantRequest(ctx, req(read, { access: 'write' }))).toMatchObject({
      code: 'GRANT_MISMATCH'
    })
    expect(await resolveGrantRequest(ctx, req(write_, { access: 'read' }))).toMatchObject({
      code: 'GRANT_MISMATCH'
    })
    expect(await resolveGrantRequest(ctx, req(dir, { access: 'write', name: 'f' }))).toMatchObject({
      code: 'GRANT_MISMATCH'
    })
  })

  it('refuses a name on a file grant', async () => {
    const file = write(path.join(outside, 'f'))
    const id = registry.issue(1, 'read', file)
    expect(await resolveGrantRequest(ctx, req(id, { name: 'other' }))).toMatchObject({
      code: 'GRANT_MISMATCH'
    })
  })

  it('refuses a read grant whose file is gone or is no longer a file', async () => {
    const file = write(path.join(outside, 'gone.txt'))
    const id = registry.issue(1, 'read', file)
    fs.rmSync(file)
    expect(await resolveGrantRequest(ctx, req(id))).toMatchObject({ code: 'NOT_FOUND' })
    fs.mkdirSync(file)
    expect(await resolveGrantRequest(ctx, req(id))).toMatchObject({ code: 'NOT_A_FILE' })
  })

  describe('folder grants', () => {
    it('resolves a file inside the folder by name', async () => {
      const file = write(path.join(home, 'docs', 'a.txt'))
      const { grant } = await readLocalDir(ctx, 1, path.join(home, 'docs'))
      expect(await resolveGrantRequest(ctx, req(grant, { name: 'a.txt' }))).toEqual({
        ok: true,
        path: file
      })
    })

    it('needs a name', async () => {
      const { grant } = await readLocalDir(ctx, 1)
      expect(await resolveGrantRequest(ctx, req(grant))).toMatchObject({
        code: 'NAME_NOT_ALLOWED'
      })
    })

    it.each(['..', '.', '../outside/x', 'a/b', '', 'a\0b'])('refuses the name %j', async (name) => {
      write(path.join(outside, 'x'))
      const { grant } = await readLocalDir(ctx, 1)
      expect(await resolveGrantRequest(ctx, req(grant, { name }))).toMatchObject({
        code: 'NAME_NOT_ALLOWED'
      })
    })

    it('reports a missing file and a folder', async () => {
      fs.mkdirSync(path.join(home, 'adir'))
      const { grant } = await readLocalDir(ctx, 1)
      expect(await resolveGrantRequest(ctx, req(grant, { name: 'nope.txt' }))).toMatchObject({
        code: 'NOT_FOUND'
      })
      expect(await resolveGrantRequest(ctx, req(grant, { name: 'adir' }))).toMatchObject({
        code: 'NOT_A_FILE'
      })
    })

    it('refuses a file that is a link out of the home folder', async () => {
      const secret = write(path.join(outside, 'secret.txt'))
      try {
        fs.symlinkSync(secret, path.join(home, 'link.txt'), WIN ? 'file' : undefined)
      } catch {
        return // creating a file symlink needs a privilege on some Windows setups
      }
      const { grant } = await readLocalDir(ctx, 1)
      expect(await resolveGrantRequest(ctx, req(grant, { name: 'link.txt' }))).toMatchObject({
        code: 'REFUSED'
      })
    })

    it('refuses a folder grant whose folder was replaced by a link elsewhere', async () => {
      fs.mkdirSync(path.join(home, 'swap'))
      write(path.join(home, 'swap', 'a.txt'))
      write(path.join(home, 'elsewhere', 'a.txt')) // still inside home: only the folder check can catch the swap
      const { grant } = await readLocalDir(ctx, 1, path.join(home, 'swap'))
      fs.rmSync(path.join(home, 'swap'), { recursive: true })
      fs.symlinkSync(path.join(home, 'elsewhere'), path.join(home, 'swap'), 'junction')
      expect(await resolveGrantRequest(ctx, req(grant, { name: 'a.txt' }))).toMatchObject({
        code: 'REFUSED'
      })
    })

    it('refuses a Windows device name only on Windows', async () => {
      const win = {
        ...ctx,
        policy: await createLocalPanePolicy({ home, refused: [appData], platform: 'win32' })
      }
      const { grant } = await readLocalDir(win, 1)
      expect(await resolveGrantRequest(win, req(grant, { name: 'CON' }))).toMatchObject({
        code: 'NAME_NOT_ALLOWED'
      })
    })

    it('refuses a file inside the app data folder, even by a folder grant that reaches it', async () => {
      write(path.join(appData, 'storage-key'))
      const id = registry.issue(1, 'dir', appData)
      expect(await resolveGrantRequest(ctx, req(id, { name: 'storage-key' }))).toMatchObject({
        code: 'REFUSED'
      })
    })
  })
})
