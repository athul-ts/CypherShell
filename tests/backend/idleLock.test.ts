/**
 * [FR-07.5][BL-18] One idle clock for the whole app, in the main process.
 *
 * Regression: every window ran its own idle timer, so typing in a terminal
 * window did not count as activity for the main window (the app locked while
 * in use), and idle connection windows locked it too.
 *
 * `src/main/idleLock.ts` has no Electron imports; it runs here with an
 * injected clock.
 */
import { describe, it, expect } from 'vitest'
import { IdleLock, parseBackendMessage } from '../../src/main/idleLock'

const MINUTE = 60_000

function harness(): { idle: IdleLock; locks: () => number; advance: (ms: number) => void } {
  let now = 1_000_000
  let locks = 0
  const idle = new IdleLock({ lock: () => locks++, now: () => now })
  return { idle, locks: () => locks, advance: (ms) => (now += ms) }
}

describe('[BL-18] IdleLock', () => {
  it('locks once after the configured minutes without input', () => {
    const { idle, locks, advance } = harness()
    idle.setPolicy({ enabled: true, autoLockMinutes: 15 })

    advance(14 * MINUTE)
    expect(idle.check()).toBe(false)
    advance(MINUTE)
    expect(idle.check()).toBe(true)
    expect(locks()).toBe(1)

    advance(30 * MINUTE)
    expect(idle.check()).toBe(false) // still locked: no second lock until input resumes
    expect(locks()).toBe(1)
  })

  it('input in any window postpones the lock', () => {
    const { idle, locks, advance } = harness()
    idle.setPolicy({ enabled: true, autoLockMinutes: 15 })

    advance(10 * MINUTE)
    idle.recordActivity() // e.g. typing in a terminal window
    advance(10 * MINUTE)
    expect(idle.check()).toBe(false)
    advance(5 * MINUTE)
    expect(idle.check()).toBe(true)
    expect(locks()).toBe(1)
  })

  it('re-arms after a lock once input resumes', () => {
    const { idle, locks, advance } = harness()
    idle.setPolicy({ enabled: true, autoLockMinutes: 1 })
    advance(MINUTE)
    idle.check()
    idle.recordActivity() // the user is back (typing the password)
    advance(MINUTE)
    expect(idle.check()).toBe(true)
    expect(locks()).toBe(2)
  })

  it('never locks while app lock is off', () => {
    const { idle, locks, advance } = harness()
    idle.setPolicy({ enabled: false, autoLockMinutes: 1 })
    advance(24 * 60 * MINUTE)
    expect(idle.check()).toBe(false)
    expect(locks()).toBe(0)
  })

  it('a new policy restarts the clock', () => {
    const { idle, advance } = harness()
    idle.setPolicy({ enabled: false, autoLockMinutes: 15 })
    advance(60 * MINUTE) // long idle while lock was off
    idle.setPolicy({ enabled: true, autoLockMinutes: 15 }) // the user just turned lock on
    expect(idle.check()).toBe(false)
  })

  it('treats a timeout below one minute as one minute', () => {
    const { idle, advance } = harness()
    idle.setPolicy({ enabled: true, autoLockMinutes: 0 })
    advance(MINUTE - 1)
    expect(idle.check()).toBe(false)
    advance(1)
    expect(idle.check()).toBe(true)
  })

  it('runs the check on its interval', () => {
    const intervals: { fn: () => void; ms: number }[] = []
    let now = 0
    let locks = 0
    const idle = new IdleLock({
      lock: () => locks++,
      now: () => now,
      setInterval: (fn, ms) => intervals.push({ fn, ms }),
      clearInterval: () => {}
    })
    idle.setPolicy({ enabled: true, autoLockMinutes: 1 })
    idle.start()
    expect(intervals).toHaveLength(1)
    expect(intervals[0].ms).toBe(10_000)
    now += MINUTE
    intervals[0].fn()
    expect(locks).toBe(1)
  })
})

describe('[BL-18] backend messages', () => {
  it('accepts the two message types the backend sends', () => {
    expect(parseBackendMessage({ type: 'locked' })).toEqual({ type: 'locked' })
    expect(parseBackendMessage({ type: 'lock-policy', enabled: true, autoLockMinutes: 5 })).toEqual(
      {
        type: 'lock-policy',
        enabled: true,
        autoLockMinutes: 5
      }
    )
  })

  it('ignores anything malformed', () => {
    for (const message of [
      null,
      'locked',
      { type: 'lock' },
      { type: 'lock-policy', enabled: 'yes', autoLockMinutes: 5 },
      { type: 'lock-policy', enabled: true, autoLockMinutes: Number.NaN }
    ]) {
      expect(parseBackendMessage(message)).toBeNull()
    }
  })
})
