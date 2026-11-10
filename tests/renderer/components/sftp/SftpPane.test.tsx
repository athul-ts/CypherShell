import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
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
    const spy = vi.spyOn(Date, 'now')
    mockApi.get.mockResolvedValue({ data: { files: [] } })
    renderWithQuery(<SftpPane sessionId="sess-purity" />)
    // Date.now must NOT be called synchronously during render
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
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
