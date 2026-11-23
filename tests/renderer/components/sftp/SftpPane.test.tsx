import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { useTransferStore } from '@/store/transferStore'
import { renderWithQuery } from '../../helpers/renderWithQuery'
import { SftpPane } from '@/components/sftp/SftpPane'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { LOCAL_FILE_MIME, localFileDragPayload } from '@/lib/localFiles'

// Isolate LocalFilePane (uses window IPC calls not relevant here)
vi.mock('@/components/sftp/LocalFilePane', () => ({
  LocalFilePane: () => <div data-testid="local-pane-mock" />
}))

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

describe('SftpPane', () => {
  it('renders without crashing given a sessionId', () => {
    mockApi.get.mockResolvedValue({ data: { files: [] } })
    expect(() => renderWithQuery(<SftpPane sessionId="sess-1" />)).not.toThrow()
  })

  it('shows the remote file panel', () => {
    mockApi.get.mockResolvedValue({ data: { files: [] } })
    renderWithQuery(<SftpPane sessionId="sess-2" />)
    // The component header is present
    expect(screen.getByTestId('local-pane-mock')).toBeInTheDocument()
  })

  it('fetches the remote file listing via the API', async () => {
    mockApi.get.mockResolvedValue({
      data: {
        files: [
          {
            name: 'readme.txt',
            type: '-',
            size: 1024,
            modifyTime: 0,
            accessTime: 0,
            permissions: 0
          }
        ]
      }
    })
    renderWithQuery(<SftpPane sessionId="sess-3" />)
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('/sftp/sess-3/list'),
        expect.anything()
      )
    })
  })
})

describe('makeTransferId (purity regression)', () => {
  it('Date.now is NOT called during the initial render of SftpPane', () => {
    const real = Date.now.bind(Date)
    const callers: string[] = []
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      callers.push(new Error().stack ?? '')
      return real()
    })
    mockApi.get.mockResolvedValue({ data: { files: [] } })
    renderWithQuery(<SftpPane sessionId="sess-purity" />)
    spy.mockRestore()
    // react-query reads the clock for its own bookkeeping; the pane's code must not.
    expect(callers.filter((stack) => /src[\\/]renderer[\\/]src/.test(stack))).toEqual([])
  })
})

const listing = {
  data: {
    files: [
      {
        name: 'notes.txt',
        type: '-',
        size: 10,
        modifyTime: 0,
        accessTime: 0,
        permissions: 0o100644
      }
    ]
  }
}

describe('[FR-04.6][FR-04.8][FR-04.9][BL-14] SFTP input dialogs', () => {
  it('New Folder opens an in-app dialog and creates the folder', async () => {
    mockApi.get.mockResolvedValue(listing)
    mockApi.post.mockResolvedValue({ data: { success: true } })
    renderWithQuery(<SftpPane sessionId="sess-mkdir" />)

    fireEvent.click(await screen.findByRole('button', { name: /new folder/i }))
    fireEvent.change(await screen.findByLabelText('Folder name'), {
      target: { value: 'backups' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/sftp/sess-mkdir/mkdir', {
        remotePath: 'backups'
      })
    )
  })

  it('Rename opens the dialog pre-filled with the file name', async () => {
    mockApi.get.mockResolvedValue(listing)
    mockApi.post.mockResolvedValue({ data: { success: true } })
    renderWithQuery(<SftpPane sessionId="sess-rename" />)

    fireEvent.click(await screen.findByTitle('Rename'))
    const input = (await screen.findByLabelText('New name')) as HTMLInputElement
    expect(input.value).toBe('notes.txt')
    fireEvent.change(input, { target: { value: 'todo.txt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/sftp/sess-rename/rename', {
        oldPath: 'notes.txt',
        newPath: 'todo.txt'
      })
    )
  })

  it('chmod rejects a non-octal mode without calling the API', async () => {
    mockApi.get.mockResolvedValue(listing)
    renderWithQuery(<SftpPane sessionId="sess-chmod" />)

    fireEvent.click(await screen.findByTitle('Change Permissions'))
    const input = (await screen.findByLabelText('Permissions')) as HTMLInputElement
    expect(input.value).toBe('644')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText(/octal digits/i)).toBeInTheDocument()
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('F2 opens the rename dialog for the selected file', async () => {
    mockApi.get.mockResolvedValue(listing)
    renderWithQuery(<SftpPane sessionId="sess-f2" />)

    fireEvent.click(await screen.findByText('notes.txt'))
    fireEvent.keyDown(document, { key: 'F2' })

    const input = (await screen.findByLabelText('New name')) as HTMLInputElement
    expect(input.value).toBe('notes.txt')
  })
})

/** The pane needs the realpath call answered too (BL-30). */
function answerWith(home: string): void {
  mockApi.get.mockImplementation(async (url: string) =>
    url.endsWith('/realpath') ? { data: { path: home } } : listing
  )
}

class FakeEventSource {
  onopen: (() => void) | null = null
  onmessage: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    setTimeout(() => this.onopen?.(), 0)
  }
  close(): void {
    /* no-op fake */
  }
}

describe('[FR-04.15][BL-30] absolute remote paths', () => {
  it('lists the absolute home directory and climbs to "/"', async () => {
    answerWith('/home/tester')
    renderWithQuery(<SftpPane sessionId="sess-abs" />)

    const listedPaths = (): string[] =>
      mockApi.get.mock.calls
        .filter(([url]) => String(url).endsWith('/list'))
        .map(([, config]) => (config as { params: { path: string } }).params.path)

    await waitFor(() => expect(listedPaths()).toContain('/home/tester'))
    expect(listedPaths()).not.toContain('.') // never lists the relative path first

    fireEvent.click(screen.getByTitle('Parent directory'))
    await waitFor(() => expect(listedPaths()).toContain('/home'))
    fireEvent.click(screen.getByTitle('Parent directory'))
    await waitFor(() => expect(listedPaths()).toContain('/'))
  })
})

const bridge = window.api as unknown as {
  pickUploadFile: ReturnType<typeof vi.fn>
  pickDownloadTarget: ReturnType<typeof vi.fn>
  grantDroppedFile: ReturnType<typeof vi.fn>
}
const GRANT = 'd'.repeat(32)

describe('[FR-04.4][BL-30][BL-47] dropping a file from the OS', () => {
  it('uploads with the grant main issued for the file — never a path', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockResolvedValue({ data: { success: true } })
    renderWithQuery(<SftpPane sessionId="sess-drop" />)
    await screen.findByText('notes.txt') // the pane has resolved its absolute home path

    const target = await screen.findByRole('button', { name: /upload/i })
    const file = new File(['x'], 'report.pdf')
    await act(async () => {
      fireEvent.drop(target, { dataTransfer: { files: [file], getData: () => '' } })
    })

    expect(bridge.grantDroppedFile).toHaveBeenCalledWith(file)
    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const [url, body] = mockApi.post.mock.calls.at(-1) as [string, Record<string, unknown>]
    expect(url).toBe('/sftp/sess-drop/upload')
    expect(body).toMatchObject({ local: { grant: GRANT }, remotePath: '/home/tester/report.pdf' })
    expect(body).not.toHaveProperty('localPath')
    vi.unstubAllGlobals()
    useTransferStore.setState({ transfers: [] })
  })

  it('says so when main cannot grant the dropped file', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockClear()
    bridge.grantDroppedFile.mockResolvedValueOnce(null)
    renderWithQuery(<SftpPane sessionId="sess-nogrant" />)

    const target = await screen.findByRole('button', { name: /upload/i })
    await act(async () => {
      fireEvent.drop(target, {
        dataTransfer: { files: [new File(['x'], 'x.bin')], getData: () => '' }
      })
    })

    expect(toast.error).toHaveBeenCalledWith('Could not read the dropped file')
    expect(mockApi.post).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('a text/plain-only drop uploads nothing', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockClear()
    renderWithQuery(<SftpPane sessionId="sess-plain" />)

    const target = await screen.findByRole('button', { name: /upload/i })
    await act(async () => {
      fireEvent.drop(target, {
        dataTransfer: {
          files: [],
          getData: (type: string) => (type === 'text/plain' ? '/etc/passwd' : '')
        }
      })
    })

    expect(mockApi.post).not.toHaveBeenCalled()
    expect(bridge.grantDroppedFile).not.toHaveBeenCalledWith(expect.anything())
    vi.unstubAllGlobals()
  })

  it('uploads a local-pane file by its folder grant and name', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockResolvedValue({ data: { success: true } })
    renderWithQuery(<SftpPane sessionId="sess-pane" />)
    await screen.findByText('notes.txt') // the pane has resolved its absolute home path

    const target = await screen.findByRole('button', { name: /upload/i })
    await act(async () => {
      fireEvent.drop(target, {
        dataTransfer: {
          files: [],
          getData: (type: string) =>
            type === LOCAL_FILE_MIME ? localFileDragPayload('e'.repeat(32), 'notes.txt') : ''
        }
      })
    })

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith(
        '/sftp/sess-pane/upload',
        expect.objectContaining({
          local: { grant: 'e'.repeat(32), name: 'notes.txt' },
          remotePath: '/home/tester/notes.txt'
        })
      )
    )
    vi.unstubAllGlobals()
    useTransferStore.setState({ transfers: [] })
  })
})

describe('[FR-04.4][FR-04.5][BL-47] the Upload and Download buttons', () => {
  it('Upload sends the grant from the native Open dialog', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockResolvedValue({ data: { success: true } })
    bridge.pickUploadFile.mockResolvedValueOnce({ grant: 'c'.repeat(32), name: 'photo.png' })
    renderWithQuery(<SftpPane sessionId="sess-btn" />)
    await screen.findByText('notes.txt') // the pane has resolved its absolute home path

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /upload/i }))
    })

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith(
        '/sftp/sess-btn/upload',
        expect.objectContaining({
          local: { grant: 'c'.repeat(32) },
          remotePath: '/home/tester/photo.png'
        })
      )
    )
    vi.unstubAllGlobals()
    useTransferStore.setState({ transfers: [] })
  })

  it('Upload does nothing when the dialog is cancelled', async () => {
    answerWith('/home/tester')
    mockApi.post.mockClear()
    bridge.pickUploadFile.mockResolvedValueOnce(null)
    renderWithQuery(<SftpPane sessionId="sess-cancel" />)
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /upload/i }))
    })
    expect(mockApi.post).not.toHaveBeenCalled()
  })
})

describe('[FR-04.13][BL-30][BL-47] retrying a failed transfer', () => {
  const failed = {
    id: 'up-old1',
    filename: 'a.txt',
    type: 'upload' as const,
    status: 'error' as const,
    bytesTransferred: 0,
    totalBytes: 0,
    percent: 0,
    error: 'Permission denied',
    startedAt: 0,
    local: { grant: 'c'.repeat(32) },
    remotePath: '/srv/a.txt'
  }

  it('shows the error and a Retry that restarts the same transfer with the same grant', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockResolvedValue({ data: { success: true } })
    useTransferStore.setState({ transfers: [failed] })
    renderWithQuery(<SftpPane sessionId="sess-retry" />)

    expect(await screen.findByText('Permission denied')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByTitle('Retry transfer'))
    })

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith(
        '/sftp/sess-retry/upload',
        expect.objectContaining({ local: { grant: 'c'.repeat(32) }, remotePath: '/srv/a.txt' })
      )
    )
    const ids = useTransferStore.getState().transfers.map((t) => t.id)
    expect(ids).not.toContain('up-old1') // the failed entry is replaced
    expect(ids).toHaveLength(1)
    vi.unstubAllGlobals()
    useTransferStore.setState({ transfers: [] })
  })

  it('a request the backend refuses becomes a visible, retryable error', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockRejectedValue({ response: { data: { error: 'Local path is not allowed' } } })
    useTransferStore.setState({ transfers: [] })
    renderWithQuery(<SftpPane sessionId="sess-refused" />)

    const target = await screen.findByRole('button', { name: /upload/i })
    await act(async () => {
      fireEvent.drop(target, {
        dataTransfer: { files: [new File(['x'], 'x.bin')], getData: () => '' }
      })
    })

    expect(await screen.findByText('Local path is not allowed')).toBeInTheDocument()
    expect(screen.getByTitle('Retry transfer')).toBeInTheDocument()
    vi.unstubAllGlobals()
    useTransferStore.setState({ transfers: [] })
  })

  it('a grant that is no longer valid hides Retry and asks to pick the file again', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockRejectedValue({
      response: {
        data: {
          error: 'This file is no longer available to this window. Pick it again.',
          code: 'GRANT_UNKNOWN'
        }
      }
    })
    useTransferStore.setState({ transfers: [] })
    renderWithQuery(<SftpPane sessionId="sess-gone" />)

    const target = await screen.findByRole('button', { name: /upload/i })
    await act(async () => {
      fireEvent.drop(target, {
        dataTransfer: { files: [new File(['x'], 'x.bin')], getData: () => '' }
      })
    })

    expect(await screen.findByText(/pick it again/i)).toBeInTheDocument()
    expect(screen.queryByTitle('Retry transfer')).toBeNull()
    vi.unstubAllGlobals()
    useTransferStore.setState({ transfers: [] })
  })
})

describe('[FR-04.5][BL-47] the Download button', () => {
  it('downloads into the file the native Save dialog granted', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockResolvedValue({ data: { success: true } })
    bridge.pickDownloadTarget.mockResolvedValueOnce({ grant: 'b'.repeat(32), name: 'notes.txt' })
    renderWithQuery(<SftpPane sessionId="sess-dl" />)

    await act(async () => {
      fireEvent.click(await screen.findByTitle('Download'))
    })

    expect(bridge.pickDownloadTarget).toHaveBeenCalledWith({ name: 'notes.txt' })
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/sftp/sess-dl/download', {
        remotePath: '/home/tester/notes.txt',
        local: { grant: 'b'.repeat(32) },
        transferId: expect.stringMatching(/^dn-/)
      })
    )
    vi.unstubAllGlobals()
    useTransferStore.setState({ transfers: [] })
  })

  it('does nothing when the Save dialog is cancelled', async () => {
    answerWith('/home/tester')
    mockApi.post.mockClear()
    bridge.pickDownloadTarget.mockResolvedValueOnce(null)
    renderWithQuery(<SftpPane sessionId="sess-dl-cancel" />)
    await act(async () => {
      fireEvent.click(await screen.findByTitle('Download'))
    })
    expect(mockApi.post).not.toHaveBeenCalled()
  })
})
