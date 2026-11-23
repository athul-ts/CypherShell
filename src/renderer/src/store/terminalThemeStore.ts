import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface TerminalThemeStore {
  theme: string
  fontSize: number
  fontFamily: string
  setTheme: (theme: string) => void
  setFontSize: (size: number) => void
  setFontFamily: (family: string) => void
}

const STORAGE_KEY = 'terminal-theme'

export const useTerminalThemeStore = create<TerminalThemeStore>()(
  persist(
    (set) => ({
      theme: 'dark',
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setFontFamily: (fontFamily) => set({ fontFamily })
    }),
    { name: STORAGE_KEY }
  )
)

// BL-35: terminals open in their own windows, so a change made in Settings arrives as a
// `storage` event there; re-read the saved state so open terminals follow it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) void useTerminalThemeStore.persist.rehydrate()
  })
}
