/**
 * [NFR-02][BL-46] The backend receives its secrets in the first message from the main process
 * (over `process.parentPort`, inside an Electron utility process) instead of its environment.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { HostBridge } from '../../backend/src/services/host-bridge.service'
import { Secrets } from '../../backend/src/config/secrets'
import { callerPolicyFromEnv } from '../../backend/src/middleware/caller.middleware'

type FakePort = EventEmitter & { postMessage: ReturnType<typeof vi.fn> }

function installParentPort(): FakePort {
  const port = new EventEmitter() as FakePort
  port.postMessage = vi.fn()
  ;(process as unknown as { parentPort?: FakePort }).parentPort = port
  return port
}

/** What Electron delivers on a utility process's parent port: `{ data }`. */
const deliver = (port: FakePort, data: unknown): boolean => port.emit('message', { data })

afterEach(() => {
  delete (process as unknown as { parentPort?: unknown }).parentPort
  Secrets.clear()
  vi.useRealTimers()
})

describe('[BL-46] Secrets', () => {
  it('falls back to the environment (tests, standalone runs)', () => {
    process.env.STORAGE_KEY = 'from-env'
    try {
      expect(Secrets.storageKey()).toBe('from-env')
      expect(Secrets.launchSecret()).toBe(process.env.LAUNCH_SECRET ?? '')
    } finally {
      delete process.env.STORAGE_KEY
    }
  })

  it('values set from the message win over the environment and never touch it', () => {
    const before = { ...process.env }
    Secrets.set({ storageKey: 'from-message', launchSecret: 'launch-from-message' })
    expect(Secrets.storageKey()).toBe('from-message')
    expect(Secrets.launchSecret()).toBe('launch-from-message')
    expect(process.env.STORAGE_KEY).toBe(before.STORAGE_KEY)
    expect(process.env.LAUNCH_SECRET).toBe(before.LAUNCH_SECRET)
  })

  it('the caller policy uses the launch secret from the message', () => {
    Secrets.set({ storageKey: 'k', launchSecret: 'launch-from-message' })
    expect(callerPolicyFromEnv().launchSecret).toBe('launch-from-message')
    // An explicit environment (as the tests pass) is still honoured.
    expect(callerPolicyFromEnv({ LAUNCH_SECRET: 'explicit' }).launchSecret).toBe('explicit')
  })
})

describe('[BL-46] HostBridge over process.parentPort', () => {
  it('is connected when a parent port exists, without CYPHERSHELL_HOST_IPC', () => {
    expect(HostBridge.isConnected()).toBe(false)
    installParentPort()
    expect(HostBridge.isConnected()).toBe(true)
  })

  it('sends through postMessage', () => {
    const port = installParentPort()
    HostBridge.send({ type: 'locked' })
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'locked' })
  })

  it('delivers well-formed messages and ignores the rest', () => {
    const port = installParentPort()
    const handler = vi.fn()
    HostBridge.onMessage(handler)
    deliver(port, { type: 'lock' })
    deliver(port, { type: 'something-else' })
    deliver(port, 'text')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ type: 'lock' })
  })
})

describe('[BL-46] HostBridge.receiveInit', () => {
  it('is null without a parent port: standalone runs and tests use the environment', async () => {
    await expect(HostBridge.receiveInit()).resolves.toBeNull()
  })

  it('announces itself, then resolves with the secrets from the first init message', async () => {
    const port = installParentPort()
    const pending = HostBridge.receiveInit()
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' })

    deliver(port, { type: 'lock' }) // not the init message: ignored
    deliver(port, { type: 'init', storageKey: 'sk', launchSecret: 'ls' })

    await expect(pending).resolves.toEqual({ storageKey: 'sk', launchSecret: 'ls' })
  })

  it('rejects a malformed init message', async () => {
    const port = installParentPort()
    const pending = HostBridge.receiveInit()
    deliver(port, { type: 'init', storageKey: 42, launchSecret: 'ls' })
    deliver(port, { type: 'init', storageKey: 'sk' })
    deliver(port, { type: 'init', storageKey: 'sk', launchSecret: 'ls' })
    await expect(pending).resolves.toEqual({ storageKey: 'sk', launchSecret: 'ls' })
  })

  it('gives up when the main process never answers', async () => {
    vi.useFakeTimers()
    installParentPort()
    const pending = HostBridge.receiveInit(1000)
    const assertion = expect(pending).rejects.toThrow(/did not send its start-up message/i)
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
  })
})
