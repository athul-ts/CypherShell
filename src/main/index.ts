import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  utilityProcess,
  type UtilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import portfinder from 'portfinder'
import iconPng from '../../resources/icon.png?asset'
import iconIco from '../../build/icon.ico?asset'
import { AppLog, createRendererErrorHandler } from './log'
import { stat, readFile, writeFile } from 'fs/promises'
import * as crypto from 'crypto'
import * as os from 'os'
import { BackendSupervisor } from './backendSupervisor'
import { attachBackendHandshake, routeBackendMessage } from './backendHandshake'
import { IdleLock } from './idleLock'
import { LocalGrantRegistry, type GrantResolveRequest } from './localGrants'
import {
  createLocalPanePolicy,
  grantDroppedFile,
  pickDownloadTarget,
  pickUploadFile,
  readLocalDir,
  resolveGrantRequest,
  type LocalFilesContext
} from './localFiles'
import { loadOrCreateStorageKey, removeLegacyJwtSecret } from './secretFiles'
import {
  ConnectionTokenBroker,
  connectionWindowRoute,
  parseConnectionWindowRequest,
  type ConnectionWindowRequest,
  type ConnectionWindowType
} from './connectionTokens'
import {
  externalUrlToOpen,
  isAppRendererUrl,
  isTrustedSenderFrame,
  type RendererLocation
} from './windowSecurity'
import { openTextFile, saveTextFile, type TextFileDeps } from './textFiles'
import { RELEASES_URL, updatePolicyFor } from './updatePolicy'
import { bringToFront } from './singleInstance'

const icon = process.platform === 'win32' ? iconIco : iconPng

let backendPort = 4000
/** NFR-03 / BL-16: owns the backend child process and restarts it after a crash. */
let backendSupervisor: BackendSupervisor | null = null
/** CODE-15: Track app-lifetime intervals so they can be cleared on shutdown. */
const appIntervals: ReturnType<typeof setInterval>[] = []

/**
 * BL-17: per-launch secret, held in memory only. The backend gets it as
 * `LAUNCH_SECRET` (the same value for every BL-16 restart) and the renderers
 * through the preload; the local API refuses `/api/auth/*` and terminal
 * WebSockets without it.
 */
const launchSecret = crypto.randomBytes(32).toString('hex')

/** Where the renderer is loaded from: the electron-vite dev server, or the packaged index.html. */
const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
const rendererLocation: RendererLocation = {
  devServerUrl,
  indexHtmlPath: join(__dirname, '../renderer/index.html')
}

let mainWindow: BrowserWindow | null = null
/** BL-18: terminal and SFTP windows, closed on every lock. */
const connectionWindows = new Set<BrowserWindow>()
/** SEC-07 / BL-20: each new connection window's one-time JWT hand-off. */
const connectionTokens = new ConnectionTokenBroker()
/** BL-47 / ADR-006: grants for the files an SFTP window may transfer. */
const localGrants = new LocalGrantRegistry()
let localFilesContext: Promise<LocalFilesContext> | null = null

/** The grant registry, the local-pane policy (home minus the app's own data) and the dialogs. */
function getLocalFiles(): Promise<LocalFilesContext> {
  localFilesContext ??= createLocalPanePolicy({
    home: os.homedir(),
    refused: [app.getPath('userData'), app.getPath('sessionData')]
  }).then((policy) => {
    const windowOf = (windowId: number): BrowserWindow | undefined =>
      BrowserWindow.getAllWindows().find((w) => w.webContents.id === windowId)
    return {
      registry: localGrants,
      policy,
      dialogs: {
        open: (windowId, options) => {
          const win = windowOf(windowId)
          const opts = options as Electron.OpenDialogOptions
          return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
        },
        save: (windowId, options) => {
          const win = windowOf(windowId)
          const opts = options as Electron.SaveDialogOptions
          return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts)
        }
      }
    }
  })
  return localFilesContext
}

/** BL-18: one idle clock for every window; the backend publishes the policy. */
const idleLock = new IdleLock({ lock: requestLock })

// BL-43: created on first use, because userData is only final once startup has set it.
let appLog: AppLog | null = null
function getAppLog(): AppLog {
  appLog ??= new AppLog(join(app.getPath('userData'), 'app.log'))
  return appLog
}

function logToFile(message: string): void {
  getAppLog().write(message)
}

/** BL-43: keeps the previous run's log as app.log.1 instead of overwriting it. */
function initLogFile(): void {
  getAppLog().start()
}

/** Sends to the main window if it is still open. */
function sendToMainWindow(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

/** BL-18: the app locked — close every terminal and SFTP window and show the lock screen. */
function onAppLocked(): void {
  localGrants.clear() // BL-47: a lock revokes every local-file grant
  for (const win of [...connectionWindows]) {
    if (!win.isDestroyed()) win.destroy()
  }
  connectionWindows.clear()
  sendToMainWindow('app:locked')
}

/** BL-18: the idle clock ran out — ask the backend to lock. */
function requestLock(): void {
  logToFile('Idle timeout reached; locking the app')
  const child = currentBackend()
  if (child) {
    try {
      child.postMessage({ type: 'lock' })
    } catch (err) {
      logToFile(`Could not ask the backend to lock: ${String(err)}`)
      onAppLocked()
    }
  } else {
    onAppLocked() // no backend holds a key right now; still hide every window's content
  }
}

/** BL-46: the backend is an Electron utility process; the supervisor holds it as a SupervisedProcess. */
function currentBackend(): UtilityProcess | null {
  return (backendSupervisor?.process as UtilityProcess | null | undefined) ?? null
}

/** BL-47: answers a backend's request to resolve a local-file grant — to that backend, once. */
async function answerGrantRequest(
  child: Pick<UtilityProcess, 'postMessage'>,
  request: GrantResolveRequest
): Promise<void> {
  let reply: { ok: true; path: string } | { ok: false; code: string }
  try {
    reply = await resolveGrantRequest(await getLocalFiles(), request)
  } catch (err) {
    logToFile(`Could not resolve a local-file grant: ${String(err)}`) // never logs the grant itself
    reply = { ok: false, code: 'REFUSED' }
  }
  try {
    child.postMessage({ type: 'grant-resolved', requestId: request.requestId, ...reply })
  } catch (err) {
    logToFile(`Could not answer a grant request: ${String(err)}`) // the backend has gone away
  }
}

/** BL-18 / BL-47: messages from the backend over the message channel. */
function handleBackendMessage(raw: unknown, child: Pick<UtilityProcess, 'postMessage'>): void {
  routeBackendMessage(raw, {
    lockPolicy: (message) => {
      idleLock.setPolicy(message)
      logToFile(
        `Auto-lock: ${message.enabled ? `after ${message.autoLockMinutes} min idle` : 'off'}`
      )
    },
    locked: () => {
      logToFile('App locked')
      onAppLocked()
    },
    grantResolve: (request) => void answerGrantRequest(child, request)
  })
}

async function startBackend(): Promise<number> {
  logToFile('Attempting to find an open port for the backend...')
  backendPort = await portfinder.getPortPromise({ port: 4000 })
  const dbPath = join(app.getPath('userData'), 'sshclient.db')
  logToFile(`Using backend port: ${backendPort}`)
  logToFile(`Using SQLite database path: ${dbPath}`)

  // BL-19: the backend creates its JWT signing secret in memory. Older
  // versions kept one on disk; remove it.
  const secretsDir = join(app.getPath('userData'), 'secrets')
  if (removeLegacyJwtSecret(secretsDir)) logToFile('Removed the legacy JWT secret file')

  // ─── Per-install random storage key (SEC-05, BL-19) ────────────────
  // Used by the backend as the PBKDF2 password when the user chooses
  // "skip lock" mode. Stored via Electron safeStorage (OS keychain:
  // DPAPI on Windows, Keychain on macOS, libsecret on Linux) when it is
  // available, otherwise as plaintext — owner-only (0600 in 0700) either way.
  // BL-36: the asynchronous safeStorage API (the synchronous one is removed in Electron 46).
  // It reads what the old API wrote, so an existing storage-key file keeps working.
  const keychain = await safeStorage.isAsyncEncryptionAvailable()
  const { key: storageKey, created } = await loadOrCreateStorageKey(
    secretsDir,
    {
      available: keychain,
      encrypt: (plain) => safeStorage.encryptStringAsync(plain),
      decrypt: async (encrypted) => {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted)
        return { plain: result, reEncrypt: shouldReEncrypt }
      }
    },
    () => crypto.randomBytes(32).toString('hex')
  )
  logToFile(
    `Storage key ${created ? 'generated' : 'loaded'} (${keychain ? 'safeStorage' : 'file-based fallback'})`
  )

  // BL-46 / ADR-005: the backend runs in an Electron utility process, in development too. It does
  // not use ELECTRON_RUN_AS_NODE, so the RunAsNode fuse can be off, and it gets the storage key and
  // the launch secret in a message instead of its environment.
  const backendScript = is.dev
    ? join(__dirname, '../../backend/dist/index.js')
    : join(process.resourcesPath, 'backend/dist/index.js')

  const backendCwd = is.dev
    ? join(__dirname, '../../backend')
    : join(process.resourcesPath, 'backend')

  logToFile(`backendScript: ${backendScript}`)
  logToFile(`backendCwd: ${backendCwd}`)

  // BL-19: a JWT_SECRET inherited from the environment is never passed on, and neither is a
  // Node-mode switch from the parent.
  const inheritedEnv: NodeJS.ProcessEnv = { ...process.env }
  delete inheritedEnv.JWT_SECRET
  delete inheritedEnv.ELECTRON_RUN_AS_NODE
  delete inheritedEnv.STORAGE_KEY
  delete inheritedEnv.LAUNCH_SECRET

  const spawnBackend = (): UtilityProcess => {
    logToFile('Starting the backend utility process...')
    const child = utilityProcess.fork(backendScript, [], {
      cwd: backendCwd,
      serviceName: 'CypherShell Backend',
      stdio: 'pipe',
      // BL-43: --enable-source-maps makes stack traces point into the TypeScript sources.
      execArgv: ['--enable-source-maps'],
      env: {
        ...inheritedEnv,
        PORT: String(backendPort),
        DATABASE_URL: `file:${dbPath}`,
        // BL-17: extra CORS origin for the electron-vite dev server only;
        // cleared otherwise so an inherited value never reaches the backend.
        ALLOWED_CORS_ORIGINS: devServerUrl ? new URL(devServerUrl).origin : '',
        NODE_ENV: 'production'
      }
    })

    child.stdout?.on('data', (data) => {
      const message = data.toString().trim()
      logToFile(`[Backend STDOUT] ${message}`)
    })

    child.stderr?.on('data', (data) => {
      const message = data.toString().trim()
      logToFile(`[Backend STDERR] ${message}`)
    })

    // The backend announces itself; main answers with the secrets (see backendHandshake.ts).
    attachBackendHandshake(child, { storageKey, launchSecret }, (raw) =>
      handleBackendMessage(raw, child)
    )

    child.on('exit', (code) => {
      logToFile(`Backend utility process exited with code ${code}`)
    })

    return child
  }

  // NFR-03 / BL-16: restart the backend if it crashes — on the same port, so
  // every window's base URL stays valid — then tell the windows to
  // re-authenticate, since the new process holds no tokens or keys.
  backendSupervisor = new BackendSupervisor({
    spawn: spawnBackend,
    log: logToFile,
    onRestart: (restart) => {
      logToFile(`Backend restarted (restart #${restart})`)
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('backend:restarted')
      }
    },
    onGiveUp: (failures) => logToFile(`Backend crashed ${failures} times; not restarting`)
  })
  backendSupervisor.start()

  return backendPort
}

let autoUpdaterStarted = false

/** Starts the auto-updater once, for the lifetime of the app. */
function setupAutoUpdater(): void {
  if (is.dev || autoUpdaterStarted) return // Skip auto-update in development
  autoUpdaterStarted = true

  logToFile('Initializing AutoUpdater...')
  // BL-24: unsigned macOS builds cannot install updates (ADR-004) — notify only
  const policy = updatePolicyFor(process.platform)
  autoUpdater.autoDownload = policy.autoDownload
  autoUpdater.autoInstallOnAppQuit = policy.autoInstallOnAppQuit

  autoUpdater.on('update-available', (info) => {
    logToFile(`AutoUpdater: update-available ${info.version}${policy.manual ? ' (manual)' : ''}`)
    sendToMainWindow('update:available', { version: info.version, manual: policy.manual })
  })

  autoUpdater.on('update-downloaded', () => {
    logToFile('AutoUpdater: update-downloaded')
    sendToMainWindow('update:downloaded')
  })

  autoUpdater.on('error', (err) => {
    const errMsg = err instanceof Error ? err.message : String(err)
    logToFile(`AutoUpdater error: ${errMsg}`)
  })

  // Check silently on startup, then every 4 hours
  autoUpdater.checkForUpdates().catch((err) => {
    logToFile(`AutoUpdater initial check error: ${err.message || err}`)
  })

  const updaterInterval = setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err) => {
        logToFile(`AutoUpdater periodic check error: ${err.message || err}`)
      })
    },
    4 * 60 * 60 * 1000
  )
  appIntervals.push(updaterInterval)
}

function createConnectionWindow(
  type: ConnectionWindowType,
  request: ConnectionWindowRequest
): void {
  const { sessionId, profileId, title, token } = request
  logToFile(
    `Creating connection window of type: ${type} for sessionId: ${sessionId}, profileId: ${profileId}`
  )

  const connWindow = new BrowserWindow({
    width: type === 'terminal' ? 960 : 1200,
    height: type === 'terminal' ? 600 : 800,
    minWidth: 600,
    minHeight: 400,
    title: `${title} (${type.toUpperCase()})`,
    autoHideMenuBar: true,
    show: false,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  connectionWindows.add(connWindow)
  const windowId = connWindow.webContents.id
  // BL-47: only SFTP windows get local-file grants, bound to their SSH session.
  if (type === 'sftp') localGrants.openWindow(windowId, sessionId)
  connWindow.on('closed', () => {
    connectionWindows.delete(connWindow)
    connectionTokens.forget(windowId)
    localGrants.closeWindow(windowId)
  })

  connWindow.on('ready-to-show', () => {
    connWindow.show()
  })

  // SEC-07 / BL-20: the token travels only through the one-time IPC hand-off,
  // to this window alone — never in the URL.
  if (token) connectionTokens.offer(windowId, token)

  const route = connectionWindowRoute(type, sessionId, profileId)
  if (devServerUrl) {
    connWindow.loadURL(`${devServerUrl}#${route}`)
  } else {
    connWindow.loadFile(rendererLocation.indexHtmlPath, { hash: route })
  }
}

function createWindow(): void {
  logToFile('Creating BrowserWindow...')
  // Create the browser window.
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'CypherShell',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.on('ready-to-show', () => {
    logToFile('BrowserWindow ready-to-show. Revealing window...')
    win.show()
    setupAutoUpdater()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(rendererLocation.indexHtmlPath)
  }
}

/**
 * BL-21: every webContents the app creates — main, terminal and SFTP windows
 * alike — denies new windows and navigation away from the app. BL-18: its
 * input feeds the shared idle clock.
 */
function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    // SEC-08: Only http(s) URLs leave the app, in the system browser
    const external = externalUrlToOpen(url)
    if (external) {
      shell
        .openExternal(external)
        .catch((err) =>
          logToFile(`openExternal failed: ${err instanceof Error ? err.message : err}`)
        )
    } else {
      logToFile(`Blocked window.open for ${url}`)
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event) => {
    if (!isAppRendererUrl(event.url, rendererLocation)) {
      event.preventDefault()
      logToFile(`Blocked navigation to ${event.url}`)
    }
  })

  contents.on('input-event', () => idleLock.recordActivity())
}

/** BL-21: IPC is served only to a top-level frame showing the app's renderer. */
function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent, channel: string): boolean {
  if (isTrustedSenderFrame(event.senderFrame, rendererLocation)) return true
  logToFile(`Refused IPC "${channel}" from ${event.senderFrame?.url ?? 'a closed frame'}`)
  return false
}

function handleTrusted(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event, channel)) throw new Error('IPC refused: untrusted sender')
    return listener(event, ...args)
  })
}

/** BL-43: error reports from the renderer land in app.log (validated and rate-limited). */
const reportRendererError = createRendererErrorHandler(logToFile)

function onSyncTrusted(channel: string, value: () => unknown): void {
  ipcMain.on(channel, (event) => {
    event.returnValue = isTrustedSender(event, channel) ? value() : null
  })
}

function openConnectionWindow(type: ConnectionWindowType, raw: unknown): void {
  const request = parseConnectionWindowRequest(raw)
  if (!request) throw new Error('Invalid connection window request')
  createConnectionWindow(type, request)
}

function registerIpcHandlers(): void {
  onSyncTrusted('get-backend-port', () => backendPort)
  onSyncTrusted('get-launch-secret', () => launchSecret) // BL-17
  // app.getVersion() reads `version` from the packaged app's package.json, so the
  // renderer reports the released version instead of a hardcoded literal that
  // silently goes stale on every bump.
  onSyncTrusted('get-app-version', () => app.getVersion())

  // BL-47 / ADR-006: local files for SFTP transfers. The page gets opaque grants, never paths it
  // could send to the backend; only SFTP windows are served (the functions check the window).
  handleTrusted('sftp:pickUploadFile', async (event) =>
    pickUploadFile(await getLocalFiles(), event.sender.id)
  )
  handleTrusted('sftp:pickDownloadTarget', async (event, request) =>
    pickDownloadTarget(await getLocalFiles(), event.sender.id, request)
  )
  handleTrusted('sftp:grantDroppedFile', async (event, path) =>
    grantDroppedFile(await getLocalFiles(), event.sender.id, path)
  )
  handleTrusted('sftp:readLocalDir', async (event, dirPath) =>
    readLocalDir(await getLocalFiles(), event.sender.id, dirPath)
  )

  // BL-22: text export/import — the renderer never names a path; main runs
  // the dialog and reads or writes only the file the user picked.
  const textFileDeps: TextFileDeps = {
    showSaveDialog: (options) => dialog.showSaveDialog(options),
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    writeFile: (filePath, content) => writeFile(filePath, content, 'utf8'),
    readFile: (filePath) => readFile(filePath, 'utf8'),
    stat: async (filePath) => {
      const stats = await stat(filePath)
      return { isFile: stats.isFile(), size: stats.size }
    }
  }
  // BL-43: the renderer's error reports (channel declared in preload/index.ts and index.d.ts)
  handleTrusted('log:rendererError', (_event, context, message) =>
    reportRendererError(context, message)
  )
  handleTrusted('dialog:saveTextFile', (_event, request) => saveTextFile(request, textFileDeps))
  handleTrusted('dialog:openTextFile', (_event, request) => openTextFile(request, textFileDeps))

  // Auto-updater IPC
  handleTrusted('updater:install', () => {
    if (!updatePolicyFor(process.platform).manual) autoUpdater.quitAndInstall() // BL-24
  })
  handleTrusted('updater:openDownloadPage', () => shell.openExternal(RELEASES_URL)) // BL-24

  // Connection Window IPC
  handleTrusted('window:openTerminal', (_event, request) =>
    openConnectionWindow('terminal', request)
  )
  handleTrusted('window:openSftp', (_event, request) => openConnectionWindow('sftp', request))
  // SEC-07 / BL-20: only the window a token was issued for can claim it, once
  handleTrusted('get-connection-token', (event) => connectionTokens.claim(event.sender.id))
}

/** CODE-08: stops the backend utility process, with a forced kill if it hangs. */
function killBackendProcess(): void {
  const backendProcess = currentBackend()
  backendSupervisor?.stop() // quitting: the coming exit is expected, do not restart
  if (!backendProcess) return
  let exited = false
  backendProcess.once('exit', () => {
    exited = true
  })
  try {
    backendProcess.kill()
    // A hung backend would otherwise be orphaned: end it by pid after 3 s.
    const forceTimer = setTimeout(() => {
      if (exited || backendProcess.pid === undefined) return
      try {
        process.kill(backendProcess.pid, 'SIGKILL') // TerminateProcess on Windows
      } catch {
        // Process already exited
      }
    }, 3000)
    backendProcess.once('exit', () => clearTimeout(forceTimer))
  } catch {
    // Process already exited or not owned
  }
}

/** Everything the (single) running instance does. */
function startPrimaryInstance(): void {
  initLogFile()

  // BL-25: a second launch brings this instance's main window to the front.
  app.on('second-instance', () => {
    logToFile('Second instance launched; focusing the running app')
    if (!bringToFront(mainWindow) && app.isReady()) createWindow()
  })

  // BL-21 / BL-18: harden every window as it is created.
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(async () => {
    logToFile('Electron app whenReady triggered')
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.cyphershell.app')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Start the backend before creating the window
    logToFile('Starting backend service...')
    await startBackend()
    idleLock.start()

    registerIpcHandlers()
    createWindow()

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on('window-all-closed', () => {
    logToFile('All windows closed event triggered')
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // Clean up the backend process when Electron quits
  app.on('will-quit', () => {
    logToFile('will-quit event triggered: Cleaning up...')
    // CODE-15: Clear app-lifetime intervals
    for (const id of appIntervals) clearInterval(id)
    appIntervals.length = 0
    idleLock.stop()
    killBackendProcess()
  })

  process.on('exit', () => {
    const backendProcess = currentBackend()
    backendSupervisor?.stop()
    if (backendProcess) {
      try {
        backendProcess.kill()
      } catch {
        // Ignore — process exiting anyway
      }
    }
  })
}

// BL-25: only one instance runs. The lock is taken before anything else, so a
// second launch neither truncates app.log nor starts a backend; it hands over
// to the running instance through 'second-instance' and quits.
if (app.requestSingleInstanceLock()) {
  startPrimaryInstance()
} else {
  app.quit()
}
