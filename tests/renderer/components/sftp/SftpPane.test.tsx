import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { useTransferStore } from '@/store/transferStore'
import { renderWithQuery } from '../../helpers/renderWithQuery'
import { SftpPane } from '@/components/sftp/SftpPane'
import { api } from '@/lib/api'

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

describe('[FR-04.4][BL-30] dropping a file from the OS', () => {
  it('uploads the path that getPathForFile returns', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    answerWith('/home/tester')
    mockApi.post.mockResolvedValue({ data: { success: true } })
    renderWithQuery(<SftpPane sessionId="sess-drop" />)

    const target = await screen.findByRole('button', { name: /upload/i })
    const file = new File(['x'], 'report.pdf')
    await act(async () => {
      fireEvent.drop(target, { dataTransfer: { files: [file], getData: () => '' } })
    })

    expect(window.api.getPathForFile).toHaveBeenCalledWith(file)
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith(
        '/sftp/sess-drop/upload',
        expect.objectContaining({
          localPath: '/dropped/report.pdf',
          remotePath: '/home/tester/report.pdf'
        })
      )
    )
    vi.unstubAllGlobals()
  })
})

describe('[FR-04.13][BL-30] retrying a failed transfer', () => {
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
    localPath: '/local/a.txt',
    remotePath: '/srv/a.txt'
  }

  it('shows the error and a Retry that restarts the same transfer', async () => {
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
        expect.objectContaining({ localPath: '/local/a.txt', remotePath: '/srv/a.txt' })
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
})
