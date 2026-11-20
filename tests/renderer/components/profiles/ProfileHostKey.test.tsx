/**
 * [FR-11][BL-38] ProfileDetailPane: a 409 HOST_KEY_* opens the dialog instead of a toast.
 */
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../helpers/renderWithQuery'
import { ProfileDetailPane } from '@/components/profiles/ProfileDetailPane'
import { api } from '@/lib/api'
import { toast } from 'sonner'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

const FP = 'SHA256:' + 'a'.repeat(43)

function setup(conflict: object): void {
  mockApi.get.mockImplementation((url: string) =>
    url === '/profiles'
      ? Promise.resolve({
          data: [
            {
              id: 'p1',
              name: 'Jump host',
              host: 'srv.local',
              port: 22,
              username: 'me',
              authMethod: 'password'
            }
          ]
        })
      : Promise.resolve({ data: { alive: true } })
  )
  mockApi.post.mockReset()
  mockApi.post.mockImplementation((url: string, body?: { acceptHostKey?: string }) => {
    if (!url.endsWith('/connect')) return Promise.resolve({ data: { success: true } })
    if (body?.acceptHostKey) return Promise.resolve({ data: { sessionId: 'session-1' } })
    return Promise.reject({ response: { status: 409, data: conflict } })
  })
}

describe('[BL-38] host-key confirmation on connect', () => {
  it('opens the dialog on HOST_KEY_UNKNOWN and Trust repeats the connect with the fingerprint', async () => {
    setup({
      code: 'HOST_KEY_UNKNOWN',
      host: 'srv.local',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint: FP,
      error: 'x'
    })
    renderWithQuery(<ProfileDetailPane profileId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: /^connect/i }))

    fireEvent.click(await screen.findByRole('button', { name: /trust and connect/i }))
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/profiles/p1/connect', { acceptHostKey: FP })
    )
    expect(toast.error).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a changed key shows the warning with no Trust button and no generic toast', async () => {
    setup({
      code: 'HOST_KEY_MISMATCH',
      host: 'srv.local',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint: FP,
      knownKeyType: 'ssh-ed25519',
      knownFingerprint: 'SHA256:' + 'b'.repeat(43),
      error: 'x'
    })
    renderWithQuery(<ProfileDetailPane profileId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: /^connect/i }))

    expect(await screen.findByText(/no password or key was sent/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /trust/i })).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
