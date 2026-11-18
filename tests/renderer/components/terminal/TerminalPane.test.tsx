/**
 * [FR-02.6][BL-17][BL-18][BL-21] TerminalPane opens the WebSocket with the
 * launch secret, does not reconnect after the app locked (close code 4001),
 * and opens links through window.open so the main process can send them to
 * the system browser.
 *
 * xterm needs a real canvas, so it is replaced by a minimal fake here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'

const xterm = vi.hoisted(() => ({
  written: [] as string[],
  linkHandler: null as null | ((event: MouseEvent, uri: string) => void)
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    loadAddon(): void {
      /* no-op fake */
    }
    open(): void {
      /* no-op fake */
    }
    write(data: string | Uint8Array): void {
      if (typeof data === 'string') xterm.written.push(data)
    }
    onSelectionChange(): void {
      /* no-op fake */
    }
    onData(): void {
      /* no-op fake */
    }
    hasSelection(): boolean {
      return false
    }
    getSelection(): string {
      return ''
    }
    dispose(): void {
      /* no-op fake */
    }
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {
      /* no-op fake */
    }
  }
}))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    constructor(handler?: (event: MouseEvent, uri: string) => void) {
      xterm.linkHandler = handler ?? null
    }
  }
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

import { TerminalPane } from '@/components/terminal/TerminalPane'

class FakeSocket {
  static readonly OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }
  send(): void {
    /* no-op fake */
  }
  close(): void {
    /* no-op fake */
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  xterm.written = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* no-op fake */
      }
      disconnect(): void {
        /* no-op fake */
      }
    }
  )
  sessionStorage.setItem('jwt', 'header.payload.sig')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('[BL-17] terminal WebSocket', () => {
  it('connects with the token and the launch secret', () => {
    render(<TerminalPane sessionId="session-1" />)
    const url = new URL(FakeSocket.instances[0].url)
    expect(url.pathname).toBe('/ws/terminal/session-1')
    expect(url.searchParams.get('token')).toBe('header.payload.sig')
    expect(url.searchParams.get('launch')).toBe('renderer-test-launch-secret')
  })
})

describe('[BL-18] after the app locked', () => {
  it('does not reconnect when the socket closes with code 4001', () => {
    render(<TerminalPane sessionId="session-1" />)
    act(() => FakeSocket.instances[0].onclose?.({ code: 4001 }))
    act(() => vi.advanceTimersByTime(10_000))
    expect(FakeSocket.instances).toHaveLength(1)
    expect(xterm.written.join('')).toContain('App locked.')
  })

  it('still reconnects after an ordinary connection loss (FR-02.6)', () => {
    render(<TerminalPane sessionId="session-1" />)
    act(() => FakeSocket.instances[0].onclose?.({ code: 1006 }))
    act(() => vi.advanceTimersByTime(1_000))
    expect(FakeSocket.instances).toHaveLength(2)
  })
})

describe('[BL-21] terminal links', () => {
  it('open through window.open with the link URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<TerminalPane sessionId="session-1" />)
    xterm.linkHandler?.(new MouseEvent('click'), 'https://example.com/')
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener')
    open.mockRestore()
  })
})
