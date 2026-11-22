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
    // The backend logs these in order; wait for the last one so a slow runner does not race it.
    await expect
      .poll(() => fs.readFileSync(log, 'utf8'), { timeout: 30000 })
      .toContain('Backend listening on 127.0.0.1')
    const text = fs.readFileSync(log, 'utf8')
    expect(text).toContain('Starting the backend utility process')
    expect(text).toContain('Start-up secrets received from the main process')
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

test('[BL-47] local files are granted by main and resolved for the backend (real round trip)', async () => {
  const launched = await launchApp()
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-grant-'))
  const source = path.join(scratch, 'upload-me.txt')
  const target = path.join(scratch, 'saved.bin')
  fs.writeFileSync(source, 'hello')

  type Picked = { grant: string; name: string } | null
  type Api = {
    backendPort: number
    launchSecret: string
    pickUploadFile: () => Promise<Picked>
    pickDownloadTarget: (r: { name: string }) => Promise<Picked>
    grantDroppedFile: (f: File) => Promise<Picked>
    readLocalDir: () => Promise<{ grant: string; parent: string | null; path: string }>
    openSftpWindow: (...a: string[]) => Promise<void>
  }

  try {
    const main = await launched.app.firstWindow()
    await main.waitForLoadState('domcontentloaded')

    // The backend starts after the window: wait until it listens before calling it.
    await expect
      .poll(() => fs.readFileSync(path.join(launched.userDataDir, 'app.log'), 'utf8'), {
        timeout: 30000
      })
      .toContain('Backend listening on 127.0.0.1')

    // A token for the SFTP window, and the native dialogs answered by main-side stubs.
    const token = await main.evaluate(async () => {
      const api = (window as unknown as { api: Api }).api
      const res = await fetch(`http://127.0.0.1:${api.backendPort}/api/auth/setup/skip`, {
        method: 'POST',
        headers: { 'X-CypherShell-Launch': api.launchSecret }
      })
      return ((await res.json()) as { token: string }).token
    })
    await launched.app.evaluate(
      ({ dialog }, files) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [files.source]
        })) as never
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: files.target })) as never
      },
      { source, target }
    )

    // The main window is not an SFTP window: main refuses it any local-file access.
    const refused = await main.evaluate(() =>
      (window as unknown as { api: Api }).api.readLocalDir().then(
        () => 'served',
        (err: Error) => String(err.message)
      )
    )
    expect(refused).toContain('Not an SFTP window')

    // Open an SFTP window the way the profile page does.
    const [sftp] = await Promise.all([
      launched.app.waitForEvent('window'),
      main.evaluate(
        (jwt) =>
          (window as unknown as { api: Api }).api.openSftpWindow('session-e2e', 'p1', 'e2e', jwt),
        token
      )
    ])
    await sftp.waitForLoadState('domcontentloaded')
    await expect.poll(() => sftp.evaluate(() => sessionStorage.getItem('jwt'))).toBeTruthy()

    const post = (
      kind: 'upload' | 'download',
      session: string,
      body: object
    ): Promise<{ status: number; body: { code?: string } }> =>
      sftp.evaluate(
        async ({ kind, session, body }) => {
          const api = (window as unknown as { api: Api }).api
          const res = await fetch(
            `http://127.0.0.1:${api.backendPort}/api/sftp/${session}/${kind}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${sessionStorage.getItem('jwt')}`,
                'X-CypherShell-Launch': api.launchSecret
              },
              body: JSON.stringify(body)
            }
          )
          return { status: res.status, body: (await res.json()) as { code?: string } }
        },
        { kind, session, body }
      )

    const up = await sftp.evaluate(() => (window as unknown as { api: Api }).api.pickUploadFile())
    expect(up?.name).toBe('upload-me.txt')
    expect(JSON.stringify(up)).not.toContain(scratch) // a grant and a name, never the path

    // The grant resolves: the backend asked main, which answered with the real path.
    const ok = await post('upload', 'session-e2e', {
      local: { grant: up!.grant },
      remotePath: '/tmp/x',
      transferId: 'up-e2e1'
    })
    expect(ok.status).toBe(200)

    const down = await sftp.evaluate(() =>
      (window as unknown as { api: Api }).api.pickDownloadTarget({ name: '..\\..\\saved.bin' })
    )
    expect(down?.name).toBe('saved.bin')
    const okDown = await post('download', 'session-e2e', {
      remotePath: '/tmp/x',
      local: { grant: down!.grant },
      transferId: 'dn-e2e1'
    })
    expect(okDown.status).toBe(200)

    // A file dropped from the OS: the preload reads its path from the real File.
    await sftp.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = 'e2e-drop'
      document.body.appendChild(input)
    })
    await sftp.locator('#e2e-drop').setInputFiles(source)
    const dropped = await sftp.evaluate(() =>
      (window as unknown as { api: Api }).api.grantDroppedFile(
        (document.getElementById('e2e-drop') as HTMLInputElement).files![0]
      )
    )
    expect(dropped?.name).toBe('upload-me.txt')
    const okDrop = await post('upload', 'session-e2e', {
      local: { grant: dropped!.grant },
      remotePath: '/tmp/y',
      transferId: 'up-e2e2'
    })
    expect(okDrop.status).toBe(200)

    // What must be refused.
    const refuse = async (
      kind: 'upload' | 'download',
      session: string,
      body: object,
      code: string
    ): Promise<void> => {
      const res = await post(kind, session, body)
      expect(res.status, JSON.stringify(res.body)).toBe(400)
      expect(res.body.code).toBe(code)
    }
    // a read grant cannot write, and a write grant cannot read
    await refuse(
      'download',
      'session-e2e',
      { remotePath: '/t', local: { grant: up!.grant }, transferId: 'dn-e2e2' },
      'GRANT_MISMATCH'
    )
    await refuse(
      'upload',
      'session-e2e',
      { local: { grant: down!.grant }, remotePath: '/t', transferId: 'up-e2e3' },
      'GRANT_MISMATCH'
    )
    // another session
    await refuse(
      'upload',
      'another-session',
      { local: { grant: up!.grant }, remotePath: '/t', transferId: 'up-e2e4' },
      'GRANT_MISMATCH'
    )
    await refuse(
      'upload',
      'session-e2e',
      { local: { grant: 'a'.repeat(32) }, remotePath: '/t', transferId: 'up-e2e5' },
      'GRANT_UNKNOWN'
    )

    const folder = await sftp.evaluate(() => (window as unknown as { api: Api }).api.readLocalDir())
    expect(folder.parent).toBeNull() // the home folder
    for (const [name, code] of [
      ['..', 'NAME_NOT_ALLOWED'],
      ['a/b', 'NAME_NOT_ALLOWED'],
      ['definitely-not-here-0123456789', 'NOT_FOUND']
    ] as const) {
      await refuse(
        'upload',
        'session-e2e',
        { local: { grant: folder.grant, name }, remotePath: '/t', transferId: 'up-e2e6' },
        code
      )
    }
    const legacy = await post('upload', 'session-e2e', {
      localPath: source,
      remotePath: '/t',
      transferId: 'up-e2e7'
    })
    expect(legacy.status).toBe(400)

    // Closing the window revokes its grants.
    await sftp.close()
    const afterClose = await main.evaluate(
      async ({ jwt, grant }) => {
        const api = (window as unknown as { api: Api }).api
        const res = await fetch(`http://127.0.0.1:${api.backendPort}/api/sftp/session-e2e/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`,
            'X-CypherShell-Launch': api.launchSecret
          },
          body: JSON.stringify({ local: { grant }, remotePath: '/t', transferId: 'up-e2e8' })
        })
        return { status: res.status, code: ((await res.json()) as { code?: string }).code }
      },
      { jwt: token, grant: up!.grant }
    )
    expect(afterClose).toEqual({ status: 400, code: 'GRANT_UNKNOWN' })

    // The grant ids never reach the log.
    const log = fs.readFileSync(path.join(launched.userDataDir, 'app.log'), 'utf8')
    expect(log).not.toContain(up!.grant)
  } finally {
    await closeApp(launched)
    fs.rmSync(scratch, { recursive: true, force: true })
  }
})
