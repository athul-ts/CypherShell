/**
 * [NFR-02][BL-46] Main answers the backend's "ready" message with its secrets; everything else
 * the backend sends is passed on. `src/main/backendHandshake.ts` has no Electron imports.
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { attachBackendHandshake, routeBackendMessage } from '../../src/main/backendHandshake'

class FakeBackend extends EventEmitter {
  postMessage = vi.fn()
}

const secrets = { storageKey: 'sk', launchSecret: 'ls' }

describe('[BL-46] attachBackendHandshake', () => {
  it('replies to "ready" with the secrets and does not pass it on', () => {
    const child = new FakeBackend()
    const onMessage = vi.fn()
    attachBackendHandshake(child, secrets, onMessage)

    child.emit('message', { type: 'ready' })

    expect(child.postMessage).toHaveBeenCalledWith({ type: 'init', ...secrets })
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('passes every other message on', () => {
    const child = new FakeBackend()
    const onMessage = vi.fn()
    attachBackendHandshake(child, secrets, onMessage)

    child.emit('message', { type: 'locked' })
    child.emit('message', { type: 'lock-policy', enabled: true, autoLockMinutes: 5 })

    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(child.postMessage).not.toHaveBeenCalled()
  })

  it('answers each started backend once', () => {
    const child = new FakeBackend()
    attachBackendHandshake(child, secrets, vi.fn())
    child.emit('message', { type: 'ready' })
    child.emit('message', { type: 'ready' })
    expect(child.postMessage).toHaveBeenCalledTimes(1)
  })

  it('never puts the secrets in anything but the init message', () => {
    const child = new FakeBackend()
    const onMessage = vi.fn()
    attachBackendHandshake(child, secrets, onMessage)
    child.emit('message', { type: 'locked' })
    expect(JSON.stringify(onMessage.mock.calls)).not.toContain('sk')
  })
})

describe('[BL-47] routeBackendMessage', () => {
  const GRANT = 'a'.repeat(32)
  const grantRequest = {
    type: 'grant-resolve',
    requestId: 'r1',
    sessionId: 's1',
    grant: GRANT,
    access: 'read'
  }

  function handlers(): {
    lockPolicy: ReturnType<typeof vi.fn>
    locked: ReturnType<typeof vi.fn>
    grantResolve: ReturnType<typeof vi.fn>
  } {
    return { lockPolicy: vi.fn(), locked: vi.fn(), grantResolve: vi.fn() }
  }

  it('sends a grant request to grantResolve, never to the lock handlers', () => {
    const h = handlers()
    routeBackendMessage(grantRequest, h)
    expect(h.grantResolve).toHaveBeenCalledWith(grantRequest)
    expect(h.locked).not.toHaveBeenCalled()
    expect(h.lockPolicy).not.toHaveBeenCalled()
  })

  it('still routes the lock messages', () => {
    const h = handlers()
    routeBackendMessage({ type: 'locked' }, h)
    routeBackendMessage({ type: 'lock-policy', enabled: true, autoLockMinutes: 5 }, h)
    expect(h.locked).toHaveBeenCalledTimes(1)
    expect(h.lockPolicy).toHaveBeenCalledWith({
      type: 'lock-policy',
      enabled: true,
      autoLockMinutes: 5
    })
    expect(h.grantResolve).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown type', { type: 'something-else' }],
    ['a malformed grant request', { ...grantRequest, grant: 'nope' }],
    ['text', 'locked'],
    ['null', null]
  ])('ignores %s and never treats it as a lock', (_label, raw) => {
    const h = handlers()
    routeBackendMessage(raw, h)
    expect(h.locked).not.toHaveBeenCalled()
    expect(h.lockPolicy).not.toHaveBeenCalled()
    expect(h.grantResolve).not.toHaveBeenCalled()
  })
})
