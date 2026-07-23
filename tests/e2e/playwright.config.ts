import { defineConfig } from '@playwright/test'
import path from 'path'

export default defineConfig({
  testDir: path.resolve('tests/e2e'),
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/report' }]],
  use: {
    // Electron-specific: no viewport needed — the window size comes from the app
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
})
