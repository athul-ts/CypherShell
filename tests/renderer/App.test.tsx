/**
 * [FR-02.9][FR-07.5][BL-18][BL-20] App-level auth wiring.
 *
 * Regressions covered:
 *  - A connection window read a JWT from its URL hash as a fallback (BL-20).
 *  - Each window ran its own idle timer; locking is now announced by the main
 *    process with `app:locked` (BL-18).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from './helpers/renderWithQuery'
import { api } from '@/lib/api'

vi.mock('@/components/terminal/TerminalPane', () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div>terminal {sessionId}</div>
}))
vi.mock('@/components/sftp/SftpPane', () => ({
  SftpPane: ({ sessionId }: { sessionId: string }) => <div>sftp {sessionId}</div>
}))

import App from '@/App'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}
const bridge = window.api as unknown as {
  getConnectionToken: ReturnType<typeof vi.fn>
  onAppLocked: ReturnType<typeof vi.fn>
}

afterEach(() => {
  window.location.hash = ''
  sessionStorage.clear()
})

function statusIs(status: { configured: boolean; locked: boolean }): void {
  mockApi.get.mockImplementation((url: string) =>
    url === '/auth/status' ? Promise.resolve({ data: status }) : Promise.resolve({ data: [] })
  )
}

describe('[BL-20] connection windows', () => {
  it('ignore a token in the URL hash', async () => {
    window.location.hash = '#/connection/terminal/session-1?profileId=p1&token=leaked.jwt.value'
    bridge.getConnectionToken.mockResolvedValue(null)
    statusIs({ configured: true, locked: true })

    renderWithQuery(<App />)

    expect(await screen.findByRole('button', { name: /^unlock$/i })).toBeInTheDocument()
    expect(sessionStorage.getItem('jwt')).toBeNull()
    expect(bridge.getConnectionToken).toHaveBeenCalledWith()
  })

  it('use the token main hands them over IPC', async () => {
    window.location.hash = '#/connection/terminal/session-1?profileId=p1'
    bridge.getConnectionToken.mockResolvedValue('claimed.jwt.value')
    statusIs({ configured: true, locked: true })

    renderWithQuery(<App />)

    expect(await screen.findByText('terminal session-1')).toBeInTheDocument()
    expect(sessionStorage.getItem('jwt')).toBe('claimed.jwt.value')
  })
})

describe('[BL-18] locking', () => {
  it('shows the lock screen and drops the token when main announces a lock', async () => {
    let announceLock = (): void => {}
    bridge.onAppLocked.mockImplementation((cb: () => void) => {
      announceLock = cb
      return () => {}
    })
    statusIs({ configured: true, locked: false })
    mockApi.post.mockResolvedValue({ data: { token: 'fresh.jwt.value' } })

    renderWithQuery(<App />)
    await waitFor(() => expect(sessionStorage.getItem('jwt')).toBe('fresh.jwt.value'))

    act(() => announceLock())

    expect(await screen.findByRole('button', { name: /^unlock$/i })).toBeInTheDocument()
    expect(sessionStorage.getItem('jwt')).toBeNull()
  })

  it('no longer runs a per-window idle timer', async () => {
    const listen = vi.spyOn(window, 'addEventListener')
    statusIs({ configured: true, locked: false })
    mockApi.post.mockResolvedValue({ data: { token: 'fresh.jwt.value' } })

    renderWithQuery(<App />)
    await waitFor(() => expect(sessionStorage.getItem('jwt')).toBe('fresh.jwt.value'))

    const events = listen.mock.calls.map((call) => call[0])
    expect(events).not.toContain('mousemove')
    expect(mockApi.post).not.toHaveBeenCalledWith('/auth/lock')
    listen.mockRestore()
  })
})
