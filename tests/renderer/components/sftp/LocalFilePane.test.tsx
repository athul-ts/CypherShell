/**
 * [FR-04.2][FR-04.15][BL-47] The local pane lists what main grants, goes Up through `parent`,
 * drags files out by grant, and turns a dropped remote file into a Save dialog in this folder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { toast } from 'sonner'
import { LocalFilePane } from '@/components/sftp/LocalFilePane'
import { LOCAL_FILE_MIME, REMOTE_FILE_MIME } from '@/lib/localFiles'

const bridge = window.api as unknown as { readLocalDir: ReturnType<typeof vi.fn> }

const HOME = '/home/tester'
const HOME_GRANT = '1'.repeat(32)
const SUB_GRANT = '2'.repeat(32)

const entry = (name: string, type: 'd' | 'f', size = 10): LocalDirEntry => ({
  name,
  type,
  size,
  modifyTime: '2026-01-01T00:00:00.000Z',
  permissions: 0o644
})

const home: LocalDirListing = {
  path: HOME,
  parent: null,
  grant: HOME_GRANT,
  files: [entry('docs', 'd'), entry('notes.txt', 'f', 2048), entry('.hidden', 'f')]
}
const docs: LocalDirListing = {
  path: `${HOME}/docs`,
  parent: HOME,
  grant: SUB_GRANT,
  files: [entry('a.md', 'f')]
}

function setup(onDownload = vi.fn()): ReturnType<typeof vi.fn> {
  render(<LocalFilePane showHidden={false} onDownload={onDownload} />)
  return onDownload
}

beforeEach(() => {
  bridge.readLocalDir.mockReset()
  bridge.readLocalDir.mockImplementation(async (p?: string) => (p === `${HOME}/docs` ? docs : home))
})

describe('[BL-47] LocalFilePane listing', () => {
  it('loads the home folder first and hides dotfiles', async () => {
    setup()
    expect(await screen.findByText('notes.txt')).toBeInTheDocument()
    expect(screen.queryByText('.hidden')).toBeNull()
    expect(bridge.readLocalDir).toHaveBeenCalledWith(undefined)
  })

  it('opens a folder with a double click and goes Up through parent', async () => {
    setup()
    fireEvent.doubleClick(await screen.findByText('docs'))
    expect(await screen.findByText('a.md')).toBeInTheDocument()
    expect(bridge.readLocalDir).toHaveBeenLastCalledWith(`${HOME}/docs`)

    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await waitFor(() => expect(bridge.readLocalDir).toHaveBeenLastCalledWith(HOME))
    expect(await screen.findByText('notes.txt')).toBeInTheDocument()
  })

  it('has nothing to go Up to at the home folder', async () => {
    setup()
    await screen.findByText('notes.txt')
    const calls = bridge.readLocalDir.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    expect(bridge.readLocalDir.mock.calls).toHaveLength(calls)
  })

  it('shows the reason in a toast when main refuses a folder, and keeps the listing', async () => {
    setup()
    fireEvent.doubleClick(await screen.findByText('docs'))
    await screen.findByText('a.md')
    bridge.readLocalDir.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'sftp:readLocalDir': Error: This folder cannot be shown"
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This folder cannot be shown'))
    expect(screen.getByText('a.md')).toBeInTheDocument()
  })
})

describe('[BL-47] dragging out of the local pane', () => {
  it('carries the folder grant and the name, never a path', async () => {
    setup()
    const row = (await screen.findByText('notes.txt')).closest('tr') as HTMLElement
    const store: Record<string, string> = {}
    fireEvent.dragStart(row, {
      dataTransfer: {
        setData: (type: string, value: string) => {
          store[type] = value
        },
        effectAllowed: ''
      }
    })
    expect(JSON.parse(store[LOCAL_FILE_MIME])).toEqual({ grant: HOME_GRANT, name: 'notes.txt' })
    expect(Object.keys(store)).toEqual([LOCAL_FILE_MIME])
    expect(JSON.stringify(store)).not.toContain(HOME + '/')
  })

  it('does not make folders draggable', async () => {
    setup()
    const row = (await screen.findByText('docs')).closest('tr') as HTMLElement
    expect(row.getAttribute('draggable')).toBe('false')
  })
})

describe('[FR-04.5][BL-47] dropping a remote file on the local pane', () => {
  const remote = { filename: 'server.log', remotePath: '/var/log/server.log', size: 99 }
  const drop = (target: HTMLElement, data: string): void => {
    fireEvent.drop(target, {
      dataTransfer: { getData: (type: string) => (type === REMOTE_FILE_MIME ? data : '') }
    })
  }

  it("hands the file and this folder's grant to onDownload", async () => {
    const onDownload = setup()
    const table = (await screen.findByText('notes.txt')).closest('table') as HTMLElement
    await act(async () => drop(table, JSON.stringify(remote)))
    expect(onDownload).toHaveBeenCalledWith(remote, HOME_GRANT)
  })

  it('uses the grant of the folder that is open', async () => {
    const onDownload = setup()
    fireEvent.doubleClick(await screen.findByText('docs'))
    const table = (await screen.findByText('a.md')).closest('table') as HTMLElement
    await act(async () => drop(table, JSON.stringify(remote)))
    expect(onDownload).toHaveBeenCalledWith(remote, SUB_GRANT)
  })

  it('ignores a drop that is not a remote file, without throwing', async () => {
    const onDownload = setup()
    const table = (await screen.findByText('notes.txt')).closest('table') as HTMLElement
    await act(async () => drop(table, '{not json'))
    await act(async () => drop(table, ''))
    expect(onDownload).not.toHaveBeenCalled()
  })
})
