import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/renderer/setup.ts'],
    include: ['tests/renderer/**/*.test.{ts,tsx}']
  },
  resolve: {
    alias: {
      '@': path.resolve('src/renderer/src'),
      '@renderer': path.resolve('src/renderer/src')
    }
  }
})
