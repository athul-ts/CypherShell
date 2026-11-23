/**
 * [NFR-03][BL-16] The Electron main process restarts a crashed backend.
 *
 * `src/main/backendSupervisor.ts` has no Electron imports, so it runs here
 * with a fake child process and an injected clock and timer.
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import { BackendSupervisor } from '../../src/main/backendSupervisor'

class FakeChild extends EventEmitter {
  crash(code = 1): void {
    this.emit('exit', code, null)
  }
}

interface Harness {
  supervisor: BackendSupervisor
  children: FakeChild[]
  timers: { fn: () => void; ms: number }[]
  onRestart: ReturnType<typeof vi.fn>
  onGiveUp: ReturnType<typeof vi.fn>
  advance: (ms: number) => void
  fireRestart: () => void
}

function harness(overrides: { windowMs?: number } = {}): Harness {
  const children: FakeChild[] = []
  const timers: { fn: () => void; ms: number }[] = []
  let clock = 0
  const onRestart = vi.fn()
  const onGiveUp = vi.fn()
  const supervisor = new BackendSupervisor({
    spawn: () => {
      const child = new FakeChild()
      children.push(child)
      return child as unknown as ChildProcess
    },
    onRestart,
    onGiveUp,
    now: () => clock,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimer: () => {},
    ...overrides
  })
  return {
    supervisor,
    children,
    timers,
    onRestart,
    onGiveUp,
    advance: (ms: number) => {
      clock += ms
    },
    /** Runs the pending restart timer. */
    fireRestart: () => timers.shift()?.fn()
  }
}

describe('[NFR-03][BL-16] BackendSupervisor', () => {
  it('restarts after a crash with growing delays', () => {
    const h = harness()
    h.supervisor.start()

    h.children[0].crash()
    expect(h.timers[0].ms).toBe(1000)
    h.fireRestart()
    expect(h.children).toHaveLength(2)
    expect(h.onRestart).toHaveBeenLastCalledWith(1)
    expect(h.supervisor.process).toBe(h.children[1])

    h.children[1].crash()
    expect(h.timers[0].ms).toBe(2000)
    h.fireRestart()
    expect(h.children).toHaveLength(3)
    expect(h.onRestart).toHaveBeenLastCalledWith(2)
  })

  it('does not restart after stop() — the exit on app quit is expected', () => {
    const h = harness()
    h.supervisor.start()
    h.supervisor.stop()
    h.children[0].crash(0)

    expect(h.timers).toHaveLength(0)
    expect(h.children).toHaveLength(1)
  })

  it('a pending restart is cancelled by stop()', () => {
    const h = harness()
    h.supervisor.start()
    h.children[0].crash()
    h.supervisor.stop()
    h.fireRestart()

    expect(h.children).toHaveLength(1)
  })

  it('gives up after 5 crashes within 2 minutes', () => {
    const h = harness()
    h.supervisor.start()
    for (let i = 0; i < 4; i++) {
      h.children[h.children.length - 1].crash()
      h.advance(1000)
      h.fireRestart()
    }
    expect(h.children).toHaveLength(5)

    h.children[4].crash()
    expect(h.timers).toHaveLength(0)
    expect(h.onGiveUp).toHaveBeenCalledWith(5)
  })

  it('forgives crashes that are spread out over time', () => {
    const h = harness()
    h.supervisor.start()
    for (let i = 0; i < 8; i++) {
      h.children[h.children.length - 1].crash()
      h.advance(3 * 60 * 1000) // longer than the 2-minute window
      h.fireRestart()
    }
    expect(h.onGiveUp).not.toHaveBeenCalled()
    expect(h.children).toHaveLength(9)
  })
})
