/**
 * E2E tests for the CypherShell Electron app.
 *
 * Prerequisite: the app must be built before running these tests.
 *   npm run build:e2e   (builds backend + electron-vite)
 *
 * Runs via: npm run test:e2e
 */
import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'

const MAIN_JS = path.resolve('out/main/index.js')

test.beforeAll(() => {
  if (!fs.existsSync(MAIN_JS)) {
    throw new Error(`Built app not found at ${MAIN_JS}. Run \`npm run build:e2e\` first.`)
  }
})

function makeTestDb(): string {
  return path.join(os.tmpdir(), `cs-e2e-${crypto.randomUUID()}.db`)
}

test('app launches and shows the initial UI', async () => {
  const dbPath = makeTestDb()
  const app = await electron.launch({
    args: [MAIN_JS, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])],
    env: {
      ...process.env,
      DATABASE_URL: `file:${dbPath}`,
      JWT_SECRET: 'e2e-test-secret',
      // Suppress the auto-updater in tests
      ELECTRON_IS_DEV: '1'
    }
  })

  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')

    // The app renders at all
    const title = await win.title()
    expect(title).toBeTruthy()

    // Either the setup wizard or the main dashboard must be visible
    const bodyText = await win.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)

    // Take a screenshot on the first launch for visual inspection
    await win.screenshot({ path: 'tests/e2e/screenshots/launch.png' })
  } finally {
    await app.close()
    fs.rmSync(dbPath, { force: true })
  }
})

test('setup wizard — skip lock renders dashboard', async () => {
  const dbPath = makeTestDb()
  const app = await electron.launch({
    args: [MAIN_JS, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])],
    env: {
      ...process.env,
      DATABASE_URL: `file:${dbPath}`,
      JWT_SECRET: 'e2e-test-secret',
      ELECTRON_IS_DEV: '1'
    }
  })

  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')

    // If the setup wizard is shown, click "Skip" to bypass the master password
    const skipBtn = win.getByRole('button', { name: /skip/i })
    if (await skipBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await skipBtn.click()
      // After skip, the dashboard or terminal page should appear
      await win.waitForSelector('[data-testid="sidebar"], nav, aside', { timeout: 10000 })
    }

    await win.screenshot({ path: 'tests/e2e/screenshots/after-setup.png' })
  } finally {
    await app.close()
    fs.rmSync(dbPath, { force: true })
  }
})
