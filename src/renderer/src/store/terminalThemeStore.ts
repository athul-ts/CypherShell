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
    { name: 'terminal-theme' }
  )
)
