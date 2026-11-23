/** [FR-02.10][BL-35] Terminal windows follow theme and font changes made in Settings. */
import { describe, it, expect } from 'vitest'
import { useTerminalThemeStore } from '@/store/terminalThemeStore'

describe('[BL-35] terminal theme store across windows', () => {
  it('re-reads the saved state when another window changes it', async () => {
    expect(useTerminalThemeStore.getState().theme).toBe('dark')

    // What the Settings window wrote, as this window sees it
    localStorage.setItem(
      'terminal-theme',
      JSON.stringify({
        state: { theme: 'dracula', fontSize: 18, fontFamily: 'monospace' },
        version: 0
      })
    )
    window.dispatchEvent(new StorageEvent('storage', { key: 'terminal-theme' }))
    await Promise.resolve()

    expect(useTerminalThemeStore.getState()).toMatchObject({
      theme: 'dracula',
      fontSize: 18,
      fontFamily: 'monospace'
    })
  })

  it('ignores changes to other keys', async () => {
    useTerminalThemeStore.setState({ theme: 'nord' })
    localStorage.setItem('unrelated', 'x')
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    await Promise.resolve()
    expect(useTerminalThemeStore.getState().theme).toBe('nord')
  })
})
