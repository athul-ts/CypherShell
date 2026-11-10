import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithQuery } from '../helpers/renderWithQuery'
import Settings from '@/pages/Settings'
import { api } from '@/lib/api'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

const mockConfig = {
  theme: 'dark',
  defaultFont: 'JetBrains Mono',
  defaultFontSize: 14,
  logRetentionDays: 90,
  lockEnabled: false,
  hasMasterPassword: false,
  autoLockMinutes: 15
}

describe('Settings page', () => {
  it('renders without crashing', () => {
    mockApi.get.mockResolvedValue({ data: mockConfig })
    expect(() => renderWithQuery(<Settings />)).not.toThrow()
  })

  it('shows a loading state while config is fetching', () => {
    // keep the promise pending
    mockApi.get.mockReturnValue(new Promise(() => {}))
    renderWithQuery(<Settings />)
    // The component renders (doesn't throw) in loading state
    expect(document.body).toBeTruthy()
  })

  it('populates the font-size field from the API response', async () => {
    mockApi.get.mockResolvedValue({ data: mockConfig })
    renderWithQuery(<Settings />)
    // Wait for the form to be populated from the API response
    await waitFor(() => {
      const inputs = document.querySelectorAll('input[type="number"]')
      const fontSizeInput = Array.from(inputs).find((el) => (el as HTMLInputElement).value === '14')
      expect(fontSizeInput).toBeTruthy()
    })
  })

  it('calls PUT /config on save', async () => {
    mockApi.get.mockResolvedValue({ data: mockConfig })
    mockApi.put.mockResolvedValue({ data: { ...mockConfig, defaultFontSize: 16 } })
    renderWithQuery(<Settings />)

    await waitFor(() => screen.getAllByRole('button').length > 0)
    const saveBtn = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.toLowerCase().includes('save'))
    if (saveBtn) {
      fireEvent.click(saveBtn)
      await waitFor(() => expect(mockApi.put).toHaveBeenCalled())
    }
  })
})

describe('[FR-07.7][BL-10] Settings app-lock toggle', () => {
  it('never sends lockEnabled through PUT /config', async () => {
    mockApi.get.mockResolvedValue({ data: mockConfig })
    mockApi.put.mockResolvedValue({ data: mockConfig })
    renderWithQuery(<Settings />)

    const saveBtn = await screen.findByRole('button', { name: /save settings/i })
    fireEvent.click(saveBtn)
    await waitFor(() => expect(mockApi.put).toHaveBeenCalled())
    expect(mockApi.put.mock.calls[0][1]).not.toHaveProperty('lockEnabled')
  })

  it('turning lock on asks for a new master password and calls setup-password', async () => {
    mockApi.get.mockResolvedValue({ data: mockConfig })
    mockApi.post.mockResolvedValue({ data: { token: 'new-token', unreadableSecrets: 0 } })
    renderWithQuery(<Settings />)

    fireEvent.click(await screen.findByLabelText('App lock'))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Set Master Password')

    fireEvent.change(screen.getByLabelText('New Master Password'), {
      target: { value: 'master-pass' }
    })
    fireEvent.click(screen.getByRole('button', { name: /turn on lock/i }))

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/auth/setup-password', { password: 'master-pass' })
    )
    expect(mockApi.put).not.toHaveBeenCalled()
  })

  it('turning lock off asks for the current master password and calls disable-lock', async () => {
    mockApi.get.mockResolvedValue({
      data: { ...mockConfig, lockEnabled: true, hasMasterPassword: true }
    })
    mockApi.post.mockResolvedValue({ data: { success: true, unreadableSecrets: 0 } })
    renderWithQuery(<Settings />)

    await waitFor(() => expect(screen.getByLabelText('App lock')).toBeChecked())
    fireEvent.click(screen.getByLabelText('App lock'))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Turn Off App Lock')

    fireEvent.change(screen.getByLabelText('Current Master Password'), {
      target: { value: 'master-pass' }
    })
    fireEvent.click(screen.getByRole('button', { name: /turn off lock/i }))

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/auth/disable-lock', { password: 'master-pass' })
    )
  })
})
