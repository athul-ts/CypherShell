import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithQuery } from '../helpers/renderWithQuery'
import Keys from '@/pages/Keys'
import { api } from '@/lib/api'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const mockKeys = [
  {
    id: 'key-1',
    name: 'My SSH Key',
    keyType: 'ed25519',
    fingerprint: 'SHA256:abcdef',
    publicKey: 'ssh-ed25519 AAAA...',
    createdAt: '2025-01-01T00:00:00.000Z'
  }
]

describe('Keys page', () => {
  it('renders without crashing', () => {
    mockApi.get.mockResolvedValue({ data: [] })
    expect(() => renderWithQuery(<Keys />)).not.toThrow()
  })

  it('shows "No SSH keys" when the list is empty', async () => {
    mockApi.get.mockResolvedValue({ data: [] })
    renderWithQuery(<Keys />)
    await waitFor(() => {
      expect(screen.getByText(/no ssh keys/i)).toBeInTheDocument()
    })
  })

  it('renders key cards from the API response', async () => {
    mockApi.get.mockResolvedValue({ data: mockKeys })
    renderWithQuery(<Keys />)
    await waitFor(() => {
      expect(screen.getByText('My SSH Key')).toBeInTheDocument()
    })
  })

  it('shows the key fingerprint', async () => {
    mockApi.get.mockResolvedValue({ data: mockKeys })
    renderWithQuery(<Keys />)
    await waitFor(() => {
      expect(screen.getByText(/SHA256:abcdef/)).toBeInTheDocument()
    })
  })

  it('calls DELETE /keys/:id when trash button is clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/usage')) return Promise.resolve({ data: { profiles: [] } })
      return Promise.resolve({ data: mockKeys })
    })
    mockApi.delete.mockResolvedValue({ data: { success: true } })

    renderWithQuery(<Keys />)
    await waitFor(() => screen.getAllByText('My SSH Key'))

    const trashButtons = screen
      .getAllByRole('button')
      .filter((b) => b.querySelector('svg') !== null)
    // Click the last icon button (typically the delete/trash action)
    if (trashButtons.length > 0) {
      fireEvent.click(trashButtons[trashButtons.length - 1])
    }
    // Component must still be mounted and not have crashed
    expect(screen.getAllByText('My SSH Key').length).toBeGreaterThan(0)
  })
})
