/**
 * [FR-11][BL-38] Settings → Known Hosts: list and remove trusted host keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../helpers/renderWithQuery'
import { KnownHostsCard } from '@/components/settings/KnownHostsCard'
import { api } from '@/lib/api'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const row = {
  id: 'k1',
  host: 'srv.local',
  port: 22,
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:' + 'a'.repeat(43),
  lastSeenAt: '2026-11-20T10:00:00.000Z'
}

beforeEach(() => {
  mockApi.get.mockReset()
  mockApi.delete.mockReset()
})

describe('[BL-38] KnownHostsCard', () => {
  it('lists host:port, type and fingerprint', async () => {
    mockApi.get.mockResolvedValue({ data: [row] })
    renderWithQuery(<KnownHostsCard />)
    expect(await screen.findByText('srv.local:22')).toBeTruthy()
    expect(screen.getByText('ssh-ed25519')).toBeTruthy()
    expect(screen.getByText(row.fingerprint)).toBeTruthy()
  })

  it('shows an empty state', async () => {
    mockApi.get.mockResolvedValue({ data: [] })
    renderWithQuery(<KnownHostsCard />)
    expect(await screen.findByText(/no trusted hosts/i)).toBeTruthy()
  })

  it('removes only after confirmation', async () => {
    mockApi.get.mockResolvedValue({ data: [row] })
    mockApi.delete.mockResolvedValue({ data: { success: true } })
    renderWithQuery(<KnownHostsCard />)
    fireEvent.click(await screen.findByRole('button', { name: /^remove/i }))
    expect(mockApi.delete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }))
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/known-hosts/k1'))
  })
})
