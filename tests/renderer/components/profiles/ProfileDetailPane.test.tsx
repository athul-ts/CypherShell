/**
 * [FR-06.3][BL-23] Stopping a dynamic (SOCKS5) tunnel sends its local port.
 *
 * Regression: the stop request sent the (empty) remote port for every
 * non-local forward, so a dynamic tunnel kept running after "stop".
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

describe('[BL-23] tunnel stop request', () => {
  it('a dynamic tunnel is stopped by its local port', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/profiles') {
        return Promise.resolve({
          data: [
            {
              id: 'p1',
              name: 'Jump host',
              host: 'jump.local',
              port: 22,
              username: 'me',
              authMethod: 'password'
            }
          ]
        })
      }
      return Promise.resolve({ data: { alive: true } })
    })
    mockApi.post.mockImplementation((url: string) =>
      url.endsWith('/connect')
        ? Promise.resolve({ data: { sessionId: 'session-9' } })
        : Promise.resolve({ data: { success: true } })
    )

    renderWithQuery(<ProfileDetailPane profileId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: /^connect/i }))
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/profiles/p1/connect'))

    fireEvent.change(await screen.findByDisplayValue('Local (L)'), {
      target: { value: 'dynamic' }
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. 8080'), { target: { value: '1080' } })
    fireEvent.click(screen.getByRole('button', { name: /start forwarding/i }))
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith(
        '/tunnels/session-9/start',
        expect.objectContaining({ type: 'dynamic', localPort: '1080' })
      )
    )

    fireEvent.click(await screen.findByTitle('Stop Tunnel'))
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/tunnels/session-9/stop', {
        type: 'dynamic',
        port: '1080'
      })
    )
  })
})

describe('[FR-06.6][BL-31] busy tunnel port', () => {
  it('names the port instead of a generic failure', async () => {
    mockApi.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/profiles'
          ? {
              data: [
                {
                  id: 'p1',
                  name: 'Box',
                  host: 'b',
                  port: 22,
                  username: 'me',
                  authMethod: 'password'
                }
              ]
            }
          : { data: { alive: true } }
      )
    )
    mockApi.post.mockImplementation((url: string) => {
      if (url.endsWith('/connect')) return Promise.resolve({ data: { sessionId: 'session-3' } })
      return Promise.reject({
        response: {
          data: { code: 'PORT_IN_USE', port: 8080, error: 'Port 8080 is already in use' }
        }
      })
    })

    renderWithQuery(<ProfileDetailPane profileId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: /^connect/i }))
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/profiles/p1/connect'))

    fireEvent.change(await screen.findByPlaceholderText('e.g. 8080'), { target: { value: '8080' } })
    fireEvent.change(screen.getByPlaceholderText('80'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: /start forwarding/i }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Port 8080 is already in use')
      )
    )
  })
})
