/**
 * E2E tests for the CypherShell Electron app.
 *
 * Prerequisite: the app must be built before running these tests.
 *   npm run build:e2e   (builds backend + electron-vite)
 *
 * Runs via: npm run test:e2e
 *
 * BL-27: every launch runs on a throwaway profile. Main keeps the database, secrets and
 * app.log in app.getPath('userData'), which without `--user-data-dir` is the user's real
 * profile (%APPDATA%\cyphershell on Windows).
 */
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

const MAIN_JS = path.resolve('out/main/index.js')

test.beforeAll(() => {
  if (!fs.existsSync(MAIN_JS)) {
    throw new Error(`Built app not found at ${MAIN_JS}. Run \`npm run build:e2e\` first.`)
  }
})

interface LaunchedApp {
  app: ElectronApplication
  /** Temp directory the app uses as its userData; deleted by closeApp(). */
  userDataDir: string
}

function removeProfile(dir: string): void {
  // Retries cover Windows file locks held for a moment after the app and backend exit.
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-e2e-'))
  try {
    const app = await electron.launch({
      args: [
        MAIN_JS,
        `--user-data-dir=${userDataDir}`,
        ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])
      ],
      env: {
        ...process.env,
        // Suppress the auto-updater in tests
        ELECTRON_IS_DEV: '1'
      }
    })
    return { app, userDataDir }
  } catch (err) {
    removeProfile(userDataDir)
    throw err
  }
}

async function closeApp({ app, userDataDir }: LaunchedApp): Promise<void> {
  try {
    await app.close()
  } finally {
    removeProfile(userDataDir)
  }
}

/** The app runs on the throwaway profile: its userData, log and database are all in it. */
async function expectThrowawayProfile(launched: LaunchedApp): Promise<void> {
  const { userDataDir } = launched
  const userData = await launched.app.evaluate(({ app }) => app.getPath('userData'))
  // realpath: os.tmpdir() can be an 8.3 short path on Windows or a symlink on macOS.
  expect(fs.realpathSync.native(userData)).toBe(fs.realpathSync.native(userDataDir))
  expect(fs.existsSync(path.join(userDataDir, 'app.log'))).toBe(true)
  await expect
    .poll(() => fs.existsSync(path.join(userDataDir, 'sshclient.db')), { timeout: 15000 })
    .toBe(true)
}

test('app launches and shows the initial UI', async () => {
  const launched = await launchApp()

  try {
    const win = await launched.app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await expectThrowawayProfile(launched)

    // The app renders at all
    const title = await win.title()
    expect(title).toBeTruthy()

    // Either the setup wizard or the main dashboard must be visible
    const bodyText = await win.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)

    // Take a screenshot on the first launch for visual inspection
    await win.screenshot({ path: 'tests/e2e/screenshots/launch.png' })
  } finally {
    await closeApp(launched)
  }
})

test('setup wizard — skip lock renders dashboard', async () => {
  const launched = await launchApp()

  try {
    const win = await launched.app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await expectThrowawayProfile(launched)

    // BL-37: a throwaway profile always starts on the setup wizard, so every step must happen.
    await win.getByRole('button', { name: /continue without a password/i }).click()
    await win.locator('#setup-skip-btn').click()
    await expect(win.getByRole('heading', { name: 'Profiles', level: 1 })).toBeVisible({
      timeout: 15000
    })

    await win.screenshot({ path: 'tests/e2e/screenshots/after-setup.png' })
  } finally {
    await closeApp(launched)
  }
})

test('[BL-43] a renderer error report lands in app.log', async () => {
  const launched = await launchApp()

  try {
    const win = await launched.app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await expectThrowawayProfile(launched)

    await win.evaluate(() =>
      (
        window as unknown as { api: { logRendererError: (c: string, m: string) => Promise<void> } }
      ).api.logRendererError('e2e', 'reported from the renderer')
    )

    const log = path.join(launched.userDataDir, 'app.log')
    await expect
      .poll(() => fs.readFileSync(log, 'utf8'), { timeout: 5000 })
      .toContain('[Renderer] e2e: reported from the renderer')
  } finally {
    await closeApp(launched)
  }
})

test('[BL-46] the backend runs in a utility process and gets its secrets in a message', async () => {
  const launched = await launchApp()

  try {
    const win = await launched.app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await expectThrowawayProfile(launched)

    const log = path.join(launched.userDataDir, 'app.log')
    await expect
      .poll(() => fs.readFileSync(log, 'utf8'), { timeout: 15000 })
      .toContain('Start-up secrets received from the main process')
    const text = fs.readFileSync(log, 'utf8')
    expect(text).toContain('Starting the backend utility process')
    expect(text).toContain('Backend listening on 127.0.0.1')
    // The window can talk to the backend: it asks for the status without a token.
    const status = await win.evaluate(async () => {
      const api = (window as unknown as { api: { backendPort: number; launchSecret: string } }).api
      const res = await fetch(`http://127.0.0.1:${api.backendPort}/api/auth/status`, {
        headers: { 'X-CypherShell-Launch': api.launchSecret }
      })
      return res.status
    })
    expect(status).toBe(200)
  } finally {
    await closeApp(launched)
  }
})
