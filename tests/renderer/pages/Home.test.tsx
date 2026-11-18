/** [FR-01.2][BL-31] Profile cards show when the profile was last connected. */
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { renderWithQuery } from '../helpers/renderWithQuery'
import Home from '@/pages/Home'
import { api } from '@/lib/api'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

const base = { host: 'h', port: 22, username: 'u', authMethod: 'password' }

describe('[FR-01.2][BL-31] last connected on profile cards', () => {
  it('shows a relative time, or "Never connected"', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/profiles') {
        return {
          data: [
            { ...base, id: 'a', name: 'Used', lastConnectedAt: twoHoursAgo },
            { ...base, id: 'b', name: 'Fresh', lastConnectedAt: null }
          ]
        }
      }
      if (url === '/config') return { data: { lockEnabled: true } }
      return { data: [] }
    })

    renderWithQuery(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    )

    expect(await screen.findByText('Last connected about 2 hours ago')).toBeInTheDocument()
    expect(screen.getByText('Never connected')).toBeInTheDocument()
  })
})
