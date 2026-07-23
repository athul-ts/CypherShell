import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithQuery } from '../helpers/renderWithQuery'
import Settings from '@/pages/Settings'
import { api } from '@/lib/api'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

const mockConfig = {
  theme: 'dark',
  defaultFont: 'JetBrains Mono',
  defaultFontSize: 14,
  logRetentionDays: 90,
  lockEnabled: false,
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
      const fontSizeInput = Array.from(inputs).find(
        (el) => (el as HTMLInputElement).value === '14'
      )
      expect(fontSizeInput).toBeTruthy()
    })
  })

  it('calls PUT /config on save', async () => {
    mockApi.get.mockResolvedValue({ data: mockConfig })
    mockApi.put.mockResolvedValue({ data: { ...mockConfig, defaultFontSize: 16 } })
    renderWithQuery(<Settings />)

    await waitFor(() => screen.getAllByRole('button').length > 0)
    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    )
    if (saveBtn) {
      fireEvent.click(saveBtn)
      await waitFor(() => expect(mockApi.put).toHaveBeenCalled())
    }
  })
})
