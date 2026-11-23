/**
 * [FR-09.1][FR-09.4][FR-10.1][FR-10.4][BL-22] Text export and import are bound
 * to native dialogs run by the main process.
 *
 * Regression: `fs:executeOp` gave the renderer generic readFile/writeFile for
 * any path under the home directory, and refused exports elsewhere.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  MAX_TEXT_FILE_BYTES,
  TEXT_FILE_FILTERS,
  openTextFile,
  safeDefaultName,
  saveTextFile,
  type TextFileDeps
} from '../../src/main/textFiles'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-textfiles-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Real file IO with scripted dialogs. */
function deps(dialog: { save?: string | null; open?: string | null }): TextFileDeps & {
  saveOptions: unknown[]
  openOptions: unknown[]
} {
  const saveOptions: unknown[] = []
  const openOptions: unknown[] = []
  return {
    saveOptions,
    openOptions,
    showSaveDialog: async (options) => {
      saveOptions.push(options)
      return dialog.save ? { canceled: false, filePath: dialog.save } : { canceled: true }
    },
    showOpenDialog: async (options) => {
      openOptions.push(options)
      return dialog.open
        ? { canceled: false, filePaths: [dialog.open] }
        : { canceled: true, filePaths: [] }
    },
    writeFile: (p, content) => fs.promises.writeFile(p, content, 'utf8'),
    readFile: (p) => fs.promises.readFile(p, 'utf8'),
    stat: async (p) => {
      const s = await fs.promises.stat(p)
      return { isFile: s.isFile(), size: s.size }
    }
  }
}

describe('[BL-22] saveTextFile', () => {
  it('writes exactly the content to the file the user picked, wherever it is', async () => {
    const target = path.join(dir, 'chosen.json')
    const d = deps({ save: target })
    const saved = await saveTextFile(
      { kind: 'json', defaultName: 'profiles-export.json', content: '{"profiles":[]}' },
      d
    )
    expect(saved).toBe(target)
    expect(fs.readFileSync(target, 'utf8')).toBe('{"profiles":[]}')
    expect(d.saveOptions[0]).toEqual({
      defaultPath: 'profiles-export.json',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
  })

  it('writes nothing when the dialog is cancelled', async () => {
    expect(
      await saveTextFile(
        { kind: 'pub', defaultName: 'k.pub', content: 'ssh-ed25519 AAAA' },
        deps({})
      )
    ).toBeNull()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('never lets the renderer point the dialog at a folder', () => {
    expect(safeDefaultName('/etc/passwd', 'json')).toBe('passwd')
    expect(safeDefaultName('..\\..\\Startup\\run.cmd', 'json')).toBe('run.cmd')
    expect(safeDefaultName('bad\u0000\u001fname.pub', 'pub')).toBe('badname.pub')
    expect(safeDefaultName(undefined, 'cskb')).toBe('export.cskb')
  })

  it('refuses unknown kinds, non-text content and oversized content', async () => {
    const d = deps({ save: path.join(dir, 'x') })
    await expect(saveTextFile({ kind: 'exe', defaultName: 'x', content: '' }, d)).rejects.toThrow()
    await expect(saveTextFile({ kind: 'json', defaultName: 'x', content: 42 }, d)).rejects.toThrow()
    await expect(
      saveTextFile(
        { kind: 'json', defaultName: 'x', content: 'a'.repeat(MAX_TEXT_FILE_BYTES + 1) },
        d
      )
    ).rejects.toThrow(/too large/)
    expect(d.saveOptions).toEqual([]) // refused before any dialog opened
  })
})

describe('[FR-08.6][BL-28] the csv kind', () => {
  it('saves the audit-log export unchanged, with the CSV filter', async () => {
    const target = path.join(dir, 'audit.csv')
    const csv = 'Timestamp,Type,Profile\n2026-11-11T10:00:00.000Z,connection,"web ""prod"", eu"'
    const d = deps({ save: target })
    const saved = await saveTextFile(
      { kind: 'csv', defaultName: 'cyphershell-audit-2026-11-11.csv', content: csv },
      d
    )
    expect(saved).toBe(target)
    expect(fs.readFileSync(target, 'utf8')).toBe(csv)
    expect(d.saveOptions[0]).toEqual({
      defaultPath: 'cyphershell-audit-2026-11-11.csv',
      filters: [
        { name: 'CSV Files', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    expect(safeDefaultName(undefined, 'csv')).toBe('export.csv')
  })

  it('accepts every kind that has a filter', async () => {
    for (const kind of Object.keys(TEXT_FILE_FILTERS)) {
      await expect(
        saveTextFile({ kind, defaultName: 'x', content: '' }, deps({}))
      ).resolves.toBeNull()
    }
  })
})

describe('[BL-22] openTextFile', () => {
  it('returns the picked file name and content, with the kind filter', async () => {
    const file = path.join(dir, 'my-key.cskb')
    fs.writeFileSync(file, '{"version":1}')
    const d = deps({ open: file })
    expect(await openTextFile({ kind: 'cskb' }, d)).toEqual({
      name: 'my-key.cskb',
      content: '{"version":1}'
    })
    expect(d.openOptions[0]).toEqual({
      properties: ['openFile'],
      filters: [{ name: 'CypherShell Key Bundle', extensions: ['cskb'] }]
    })
  })

  it('returns null when cancelled', async () => {
    expect(await openTextFile({ kind: 'json' }, deps({}))).toBeNull()
  })

  it('refuses a file over the size limit', async () => {
    const file = path.join(dir, 'huge.json')
    fs.writeFileSync(file, Buffer.alloc(MAX_TEXT_FILE_BYTES + 1, 0x20))
    await expect(openTextFile({ kind: 'json' }, deps({ open: file }))).rejects.toThrow(/too large/)
  })

  it('takes no path from the renderer — only the kind', async () => {
    const d = deps({ open: null })
    await openTextFile({ kind: 'json', path: '/etc/shadow' }, d)
    expect(d.openOptions[0]).not.toHaveProperty('defaultPath')
  })
})
