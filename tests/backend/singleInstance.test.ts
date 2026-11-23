/**
 * [NFR-03][BL-25] A second launch brings the running app's main window to
 * the front. (The lock itself is `app.requestSingleInstanceLock()`; the
 * end-to-end check is a manual two-launch run, recorded in the SRS.)
 */
import { describe, it, expect } from 'vitest'
import { bringToFront, type FocusableWindow } from '../../src/main/singleInstance'

function fakeWindow(state: { minimized?: boolean; destroyed?: boolean } = {}): FocusableWindow & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    isDestroyed: () => state.destroyed ?? false,
    isMinimized: () => state.minimized ?? false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  }
}

describe('[BL-25] bringToFront', () => {
  it('restores a minimized window, then shows and focuses it', () => {
    const win = fakeWindow({ minimized: true })
    expect(bringToFront(win)).toBe(true)
    expect(win.calls).toEqual(['restore', 'show', 'focus'])
  })

  it('shows and focuses a window behind others', () => {
    const win = fakeWindow()
    expect(bringToFront(win)).toBe(true)
    expect(win.calls).toEqual(['show', 'focus'])
  })

  it('reports when there is no window to show, so the caller creates one', () => {
    expect(bringToFront(null)).toBe(false)
    expect(bringToFront(fakeWindow({ destroyed: true }))).toBe(false)
  })
})
