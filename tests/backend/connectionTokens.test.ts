/**
 * [FR-02.9][BL-20] Connection windows get their JWT through a one-time IPC
 * hand-off — never in the URL — and only the window it was issued for can
 * claim it.
 *
 * Regressions: production builds appended `&token=<JWT>` to every terminal
 * and SFTP window URL, and the hand-off was keyed by session id, so two
 * windows for one session competed for a single token.
 */
import { describe, it, expect } from 'vitest'
import {
  ConnectionTokenBroker,
  connectionWindowRoute,
  parseConnectionWindowRequest
} from '../../src/main/connectionTokens'

function brokerWithClock(): { broker: ConnectionTokenBroker; expireAll: () => void } {
  const timers: (() => void)[] = []
  const broker = new ConnectionTokenBroker({
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {}
  })
  return { broker, expireAll: () => timers.splice(0).forEach((fn) => fn()) }
}

describe('[BL-20] connection window route', () => {
  it('carries the session and profile but no token', () => {
    const route = connectionWindowRoute('terminal', 'session-1234', 'cprofile1')
    expect(route).toBe('/connection/terminal/session-1234?profileId=cprofile1')
    expect(route).not.toMatch(/token/i)
  })
})

describe('[BL-20] one-time token hand-off', () => {
  it('gives the token to the window it was issued for, once', () => {
    const { broker } = brokerWithClock()
    broker.offer(7, 'jwt-for-window-7')
    expect(broker.claim(8)).toBeNull() // another window
    expect(broker.claim(7)).toBe('jwt-for-window-7')
    expect(broker.claim(7)).toBeNull() // a second claim
  })

  it('two windows for the same session each get their own token', () => {
    const { broker } = brokerWithClock()
    broker.offer(1, 'terminal-token')
    broker.offer(2, 'sftp-token')
    expect(broker.claim(2)).toBe('sftp-token')
    expect(broker.claim(1)).toBe('terminal-token')
  })

  it('forgets an unclaimed token after the time-out, or when the window closes', () => {
    const { broker, expireAll } = brokerWithClock()
    broker.offer(1, 'late')
    expireAll()
    expect(broker.claim(1)).toBeNull()

    broker.offer(2, 'closed-window')
    broker.forget(2)
    expect(broker.claim(2)).toBeNull()
  })
})

describe('[BL-20] window request validation', () => {
  it('accepts what ProfileDetailPane sends', () => {
    expect(
      parseConnectionWindowRequest({
        sessionId: 'session-0b9c1f2e-1111-2222-3333-444455556666',
        profileId: 'cm3x9k2ab0000xyz',
        title: 'prod-db',
        token: 'a.b.c'
      })
    ).toEqual({
      sessionId: 'session-0b9c1f2e-1111-2222-3333-444455556666',
      profileId: 'cm3x9k2ab0000xyz',
      title: 'prod-db',
      token: 'a.b.c'
    })
  })

  it('refuses ids that could change the route', () => {
    for (const sessionId of ['', 'a/b', 'x?token=1', 'x#y', '../x']) {
      expect(
        parseConnectionWindowRequest({ sessionId, profileId: 'p', title: 't', token: '' })
      ).toBeNull()
    }
    expect(
      parseConnectionWindowRequest({
        sessionId: 's',
        profileId: 'p&token=x',
        title: 't',
        token: ''
      })
    ).toBeNull()
    expect(parseConnectionWindowRequest(null)).toBeNull()
  })
})
