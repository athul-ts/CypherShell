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
  delete: ReturnType<typeof vi.fn>
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

describe('[FR-06.4][BL-34] saved tunnel rules', () => {
  const profile = {
    id: 'p1',
    name: 'Box',
    host: 'b',
    port: 22,
    username: 'me',
    authMethod: 'password'
  }
  const saved = [
    {
      id: 't1',
      type: 'local',
      localPort: 8080,
      remoteHost: 'db.internal',
      remotePort: 5432,
      label: null
    },
    { id: 't2', type: 'dynamic', localPort: 1080, remoteHost: null, remotePort: null, label: null }
  ]

  async function connected(rules: object[] = saved): Promise<void> {
    mockApi.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/profiles'
          ? { data: [profile] }
          : url === '/profiles/p1/tunnels'
            ? { data: rules }
            : { data: { alive: true } }
      )
    )
    mockApi.post.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/connect')
          ? { data: { sessionId: 'session-7' } }
          : { data: { success: true } }
      )
    )
    mockApi.delete.mockResolvedValue({ data: { success: true } })
    renderWithQuery(<ProfileDetailPane profileId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: /^connect/i }))
    await screen.findByText('Saved Rules')
  }

  it('lists the saved rules', async () => {
    await connected()
    expect(await screen.findByText('8080 ↔ db.internal:5432')).toBeInTheDocument()
    expect(screen.getByText('SOCKS5 proxy on :1080')).toBeInTheDocument()
  })

  it('shows an empty state without rules', async () => {
    await connected([])
    expect(await screen.findByText('No saved rules')).toBeInTheDocument()
  })

  it('"Start saved rule" starts that tunnel on the session', async () => {
    await connected()
    fireEvent.click((await screen.findAllByTitle('Start saved rule'))[0])

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/tunnels/session-7/start', {
        type: 'local',
        localPort: '8080',
        remoteHost: 'db.internal',
        remotePort: '5432'
      })
    )
    expect(await screen.findByText('Active Forwards')).toBeInTheDocument()
  })

  it('"Save rule" stores the form as a rule of the profile', async () => {
    await connected([])
    fireEvent.change(await screen.findByPlaceholderText('e.g. 8080'), { target: { value: '9000' } })
    fireEvent.change(screen.getByPlaceholderText('80'), { target: { value: '443' } })
    fireEvent.click(screen.getByRole('button', { name: /save rule/i }))

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/profiles/p1/tunnels', {
        type: 'local',
        localPort: '9000',
        remoteHost: '127.0.0.1',
        remotePort: '443'
      })
    )
  })

  it('"Delete saved rule" deletes it', async () => {
    await connected()
    fireEvent.click((await screen.findAllByTitle('Delete saved rule'))[1])
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/profiles/p1/tunnels/t2'))
  })
})
