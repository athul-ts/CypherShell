/**
 * [NFR-02][BL-47] The backend asks the main process to resolve a grant (over `process.parentPort`)
 * and never takes a local path from a request.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { HostBridge } from '../../backend/src/services/host-bridge.service'
import { LocalGrantError, LocalGrantService } from '../../backend/src/services/local-grant.service'

type FakePort = EventEmitter & { postMessage: ReturnType<typeof vi.fn> }

function installParentPort(): FakePort {
  const port = new EventEmitter() as FakePort
  port.postMessage = vi.fn()
  ;(process as unknown as { parentPort?: FakePort }).parentPort = port
  return port
}
const reply = (port: FakePort, data: unknown): boolean => port.emit('message', { data })
const lastRequest = (port: FakePort): Record<string, unknown> =>
  port.postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>

const GRANT = 'a'.repeat(32)

afterEach(() => {
  delete (process as unknown as { parentPort?: unknown }).parentPort
  vi.useRealTimers()
})

describe('[BL-47] HostBridge.resolveLocalGrant', () => {
  it('sends a grant-resolve request and resolves with the matching reply', async () => {
    const port = installParentPort()
    const pending = HostBridge.resolveLocalGrant({
      sessionId: 's1',
      grant: GRANT,
      access: 'read',
      name: 'a.txt'
    })
    const sent = lastRequest(port)
    expect(sent).toMatchObject({
      type: 'grant-resolve',
      sessionId: 's1',
      grant: GRANT,
      access: 'read',
      name: 'a.txt'
    })
    expect(typeof sent.requestId).toBe('string')

    reply(port, { type: 'grant-resolved', requestId: sent.requestId, ok: true, path: '/tmp/a.txt' })
    await expect(pending).resolves.toEqual({ ok: true, path: '/tmp/a.txt' })
  })

  it('ignores replies for other requests and unrelated messages', async () => {
    const port = installParentPort()
    const pending = HostBridge.resolveLocalGrant({ sessionId: 's', grant: GRANT, access: 'read' })
    const { requestId } = lastRequest(port)

    reply(port, { type: 'grant-resolved', requestId: 'someone-else', ok: true, path: '/evil' })
    reply(port, { type: 'lock' })
    reply(port, 'text')
    reply(port, { type: 'grant-resolved', requestId, ok: false, code: 'GRANT_UNKNOWN' })

    await expect(pending).resolves.toEqual({ ok: false, code: 'GRANT_UNKNOWN' })
  })

  it('keeps concurrent requests apart', async () => {
    const port = installParentPort()
    const a = HostBridge.resolveLocalGrant({ sessionId: 's', grant: GRANT, access: 'read' })
    const idA = lastRequest(port).requestId
    const b = HostBridge.resolveLocalGrant({
      sessionId: 's',
      grant: 'b'.repeat(32),
      access: 'write'
    })
    const idB = lastRequest(port).requestId
    expect(idA).not.toBe(idB)

    reply(port, { type: 'grant-resolved', requestId: idB, ok: true, path: '/tmp/b' })
    reply(port, { type: 'grant-resolved', requestId: idA, ok: true, path: '/tmp/a' })

    await expect(a).resolves.toEqual({ ok: true, path: '/tmp/a' })
    await expect(b).resolves.toEqual({ ok: true, path: '/tmp/b' })
  })

  it.each([
    ['a path that is not absolute', { ok: true, path: 'relative/x' }],
    ['a path with a NUL byte', { ok: true, path: '/tmp/a\0b' }],
    ['no path', { ok: true }],
    ['an unknown code', { ok: false, code: 'WHATEVER' }]
  ])('treats a matching reply with %s as unavailable', async (_label, body) => {
    const port = installParentPort()
    const pending = HostBridge.resolveLocalGrant({ sessionId: 's', grant: GRANT, access: 'read' })
    reply(port, { type: 'grant-resolved', requestId: lastRequest(port).requestId, ...body })
    await expect(pending).resolves.toEqual({ ok: false, code: 'UNAVAILABLE' })
  })

  it('is unavailable when the main process never answers', async () => {
    vi.useFakeTimers()
    installParentPort()
    const pending = HostBridge.resolveLocalGrant(
      { sessionId: 's', grant: GRANT, access: 'read' },
      1000
    )
    await vi.advanceTimersByTimeAsync(1001)
    await expect(pending).resolves.toEqual({ ok: false, code: 'UNAVAILABLE' })
  })

  it('is unavailable without a parent port (tests, standalone runs)', async () => {
    await expect(
      HostBridge.resolveLocalGrant({ sessionId: 's', grant: GRANT, access: 'read' })
    ).resolves.toEqual({ ok: false, code: 'UNAVAILABLE' })
  })

  it('removes its listener when done', async () => {
    const port = installParentPort()
    const pending = HostBridge.resolveLocalGrant({ sessionId: 's', grant: GRANT, access: 'read' })
    expect(port.listenerCount('message')).toBe(1)
    reply(port, {
      type: 'grant-resolved',
      requestId: lastRequest(port).requestId,
      ok: true,
      path: '/tmp/a'
    })
    await pending
    expect(port.listenerCount('message')).toBe(0)
  })

  it('does not let the lock handler see grant replies', () => {
    const port = installParentPort()
    const handler = vi.fn()
    HostBridge.onMessage(handler)
    reply(port, { type: 'grant-resolved', requestId: 'x', ok: true, path: '/tmp/a' })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('[BL-47] LocalGrantService.resolve', () => {
  it('returns the path main resolved, never anything from the request', async () => {
    const restore = LocalGrantService.useResolver(async (request) =>
      request.grant === GRANT
        ? { ok: true, path: '/granted/file.txt' }
        : { ok: false, code: 'GRANT_UNKNOWN' }
    )
    try {
      await expect(
        LocalGrantService.resolve('s1', { grant: GRANT, name: '../../etc/passwd' }, 'read')
      ).resolves.toBe('/granted/file.txt')
    } finally {
      restore()
    }
  })

  it('passes the session, grant, access and name to main', async () => {
    const resolver = vi.fn().mockResolvedValue({ ok: true, path: '/p' })
    const restore = LocalGrantService.useResolver(resolver)
    try {
      await LocalGrantService.resolve('sess', { grant: GRANT, name: 'n.txt' }, 'read')
      expect(resolver).toHaveBeenCalledWith({
        sessionId: 'sess',
        grant: GRANT,
        access: 'read',
        name: 'n.txt'
      })
    } finally {
      restore()
    }
  })

  it.each([
    ['GRANT_UNKNOWN', 400, /pick it again/i],
    ['GRANT_MISMATCH', 400, /cannot be used/i],
    ['NAME_NOT_ALLOWED', 400, /name is not allowed/i],
    ['REFUSED', 400, /cannot be used/i],
    ['NOT_FOUND', 400, /not found/i],
    ['NOT_A_FILE', 400, /not a regular file/i],
    ['UNAVAILABLE', 503, /try again/i]
  ] as const)('maps %s to %i', async (code, status, message) => {
    const restore = LocalGrantService.useResolver(async () => ({ ok: false, code }))
    try {
      const error = await LocalGrantService.resolve('s', { grant: GRANT }, 'read').catch((e) => e)
      expect(error).toBeInstanceOf(LocalGrantError)
      expect(error).toMatchObject({ code, status })
      expect(error.message).toMatch(message)
    } finally {
      restore()
    }
  })

  it('restores the real resolver afterwards', async () => {
    const restore = LocalGrantService.useResolver(async () => ({ ok: true, path: '/p' }))
    restore()
    await expect(LocalGrantService.resolve('s', { grant: GRANT }, 'read')).rejects.toMatchObject({
      code: 'UNAVAILABLE'
    })
  })
})
