/**
 * [NFR-02][BL-47] The real preload exposes grants, not local paths: no call returns a path to the
 * page, and a dropped file's path goes straight from `webUtils` to main.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

const exposed: Record<string, Record<string, unknown>> = {}
const invoke = vi.fn()
const getPathForFile = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: Record<string, unknown>) => {
      exposed[name] = api
    }
  },
  ipcRenderer: {
    sendSync: () => 'x',
    invoke: (...args: unknown[]) => invoke(...args),
    on: vi.fn(),
    removeListener: vi.fn()
  },
  webUtils: { getPathForFile: (file: unknown) => getPathForFile(file) }
}))

let api: Record<string, (...args: unknown[]) => unknown>

beforeAll(async () => {
  ;(process as unknown as { contextIsolated: boolean }).contextIsolated = true
  await import('../../src/preload/index')
  api = exposed.api as typeof api
})

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue(null)
  getPathForFile.mockReset()
})

describe('[BL-47] preload bridge', () => {
  it('exposes the grant calls and none that hand a local path to the page', () => {
    for (const name of [
      'pickUploadFile',
      'pickDownloadTarget',
      'grantDroppedFile',
      'readLocalDir'
    ]) {
      expect(typeof api[name]).toBe('function')
    }
    for (const gone of [
      'openFileDialog',
      'openDirectoryDialog',
      'saveFileDialog',
      'getPathForFile'
    ]) {
      expect(api).not.toHaveProperty(gone)
    }
  })

  it('sends the SFTP channels', async () => {
    await api.pickUploadFile()
    await api.pickDownloadTarget({ name: 'a.txt', folder: 'f'.repeat(32) })
    await api.readLocalDir('/home/me')
    expect(invoke.mock.calls).toEqual([
      ['sftp:pickUploadFile'],
      ['sftp:pickDownloadTarget', { name: 'a.txt', folder: 'f'.repeat(32) }],
      ['sftp:readLocalDir', '/home/me']
    ])
  })

  it("sends a dropped file's path to main and returns only what main answers", async () => {
    getPathForFile.mockReturnValue('/Users/me/secret.txt')
    invoke.mockResolvedValue({ grant: 'g'.repeat(32), name: 'secret.txt' })

    const result = await api.grantDroppedFile({ name: 'secret.txt' })

    expect(invoke).toHaveBeenCalledWith('sftp:grantDroppedFile', '/Users/me/secret.txt')
    expect(result).toEqual({ grant: 'g'.repeat(32), name: 'secret.txt' })
    expect(JSON.stringify(result)).not.toContain('/Users/me')
  })

  it('returns null without asking main for a File that has no path or is not a File', async () => {
    getPathForFile.mockReturnValue('')
    expect(await api.grantDroppedFile({})).toBeNull()
    getPathForFile.mockImplementation(() => {
      throw new Error('not a File')
    })
    expect(await api.grantDroppedFile('nope')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
})
