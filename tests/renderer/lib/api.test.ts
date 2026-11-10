/**
 * [NFR-02][BL-16] A 401 outside /auth means the session token is no longer
 * valid (expired, revoked, or the backend restarted) and triggers
 * re-authentication; a 401 from /auth is just a wrong password.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'

// The global test setup mocks '@/lib/api'; this test needs the real client.
const { api, setUnauthorizedHandler } =
  await vi.importActual<typeof import('@/lib/api')>('@/lib/api')

function respondWith(status: number): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError('Request failed', String(status), config, null, {
      status,
      statusText: '',
      data: {},
      headers: {},
      config
    })
  }
}

afterEach(() => setUnauthorizedHandler(null))

describe('[BL-16] 401 interceptor', () => {
  it('calls the unauthorized handler for a rejected token', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await expect(api.get('/profiles', { adapter: respondWith(401) })).rejects.toBeInstanceOf(
      AxiosError
    )
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('ignores a 401 from /auth endpoints (wrong password)', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await expect(api.post('/auth/unlock', {}, { adapter: respondWith(401) })).rejects.toThrow()
    await expect(
      api.post('/auth/disable-lock', {}, { adapter: respondWith(401) })
    ).rejects.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores other errors', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await expect(api.get('/profiles', { adapter: respondWith(500) })).rejects.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})
