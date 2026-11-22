/**
 * [NFR-02][BL-46] Main answers the backend's "ready" message with its secrets; everything else
 * the backend sends is passed on. `src/main/backendHandshake.ts` has no Electron imports.
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { attachBackendHandshake } from '../../src/main/backendHandshake'

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
