/**
 * [NFR-02][BL-17] The renderer proves it is CypherShell's own: every API
 * request carries the per-launch secret, and so does the terminal WebSocket.
 */
import { describe, it, expect, vi } from 'vitest'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import { terminalSocketUrl, openTerminalLink } from '@/lib/terminalSocket'

// The global test setup mocks '@/lib/api'; this test needs the real client.
const { api, LAUNCH_SECRET_HEADER } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')

describe('[BL-17] API client', () => {
  it('sends X-CypherShell-Launch with every request', async () => {
    let seen: InternalAxiosRequestConfig | undefined
    const capture: AxiosAdapter = async (config) => {
      seen = config
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
    }
    await api.get('/auth/status', { adapter: capture })
    expect(LAUNCH_SECRET_HEADER).toBe('X-CypherShell-Launch')
    expect(seen?.headers[LAUNCH_SECRET_HEADER]).toBe('renderer-test-launch-secret')
  })
})

describe('[BL-17] terminal WebSocket URL', () => {
  it('carries the token and the launch secret', () => {
    const url = new URL(terminalSocketUrl(4000, 'session-1', 'a.b.c', 'launch-123'))
    expect(url.origin).toBe('ws://127.0.0.1:4000')
    expect(url.pathname).toBe('/ws/terminal/session-1')
    expect(url.searchParams.get('token')).toBe('a.b.c')
    expect(url.searchParams.get('launch')).toBe('launch-123')
  })

  it('omits what it does not have', () => {
    expect(terminalSocketUrl(4000, 's', null, undefined)).toBe('ws://127.0.0.1:4000/ws/terminal/s')
  })
})

describe('[BL-21] terminal links', () => {
  it('pass the URL to window.open, so main can open it in the system browser', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    openTerminalLink(new MouseEvent('click'), 'https://example.com/docs')
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener')
    open.mockRestore()
  })
})
