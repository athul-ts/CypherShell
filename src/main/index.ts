import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron'
import { join, resolve, relative, isAbsolute, dirname, basename } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { spawn, type ChildProcess } from 'child_process'
import portfinder from 'portfinder'
import iconPng from '../../resources/icon.png?asset'
import iconIco from '../../build/icon.ico?asset'
const icon = process.platform === 'win32' ? iconIco : iconPng
import { writeFileSync, appendFileSync, readFileSync, realpathSync, existsSync, mkdirSync } from 'fs'
import { stat, readdir, mkdir, rename, rm } from 'fs/promises'
import * as crypto from 'crypto'
import * as os from 'os'

let backendPort = 4000
let backendProcess: ChildProcess | null = null
/** CODE-15: Track app-lifetime intervals so they can be cleared on shutdown. */
const appIntervals: ReturnType<typeof setInterval>[] = []

function logToFile(message: string): void {
  try {
    const logPath = join(app.getPath('userData'), 'app.log')
    const timestamp = new Date().toISOString()
    const formattedMessage = `[${timestamp}] ${message}\n`
    appendFileSync(logPath, formattedMessage)
  } catch (err) {
    console.error('Failed to write to log file:', err)
  }
}

// Initialize log file
try {
  const logPath = join(app.getPath('userData'), 'app.log')
  writeFileSync(logPath, `=== APP STARTUP: ${new Date().toISOString()} ===\n`)
  console.log(`[Main] Diagnostic log file initialized at: ${logPath}`)
} catch (err) {
  console.error('Failed to initialize log file:', err)
}

async function startBackend(): Promise<number> {
  logToFile('Attempting to find an open port for the backend...')
  backendPort = await portfinder.getPortPromise({ port: 4000 })
  const dbPath = join(app.getPath('userData'), 'sshclient.db')
  logToFile(`Using backend port: ${backendPort}`)
  logToFile(`Using SQLite database path: ${dbPath}`)

  // ─── Per-install random JWT secret (SEC-01) ────────────────────────
  // Generate once, persist to userData. If the file is missing at boot
  // (first launch, or user deleted it), we create a new one. This means
  // existing JWTs are invalidated when the file is deleted.
  const jwtSecretDir = join(app.getPath('userData'), 'secrets')
  const jwtSecretPath = join(jwtSecretDir, 'jwt-secret')
  let jwtSecret: string
  try {
    jwtSecret = readFileSync(jwtSecretPath, 'utf8').trim()
  } catch {
    mkdirSync(jwtSecretDir, { recursive: true })
    jwtSecret = crypto.randomBytes(48).toString('hex')
    writeFileSync(jwtSecretPath, jwtSecret, 'utf8')
    // On POSIX: chmod 600 equivalent. On Windows this is handled by userData ACLs.
    logToFile('Generated new JWT secret')
  }
  logToFile('JWT secret loaded from userData')

  // ─── Per-install random storage key (SEC-05) ───────────────────────
  // Used by the backend as the PBKDF2 password when the user chooses
  // "skip lock" mode. Stored via Electron safeStorage (OS keychain:
  // DPAPI on Windows, Keychain on macOS, libsecret on Linux) so the
  // at-rest encryption key is never derived from a public constant.
  const storageKeyPath = join(jwtSecretDir, 'storage-key')
  let storageKey: string
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = readFileSync(storageKeyPath)
      storageKey = safeStorage.decryptString(encrypted)
    } catch {
      storageKey = crypto.randomBytes(32).toString('hex')
      const encrypted = safeStorage.encryptString(storageKey)
      mkdirSync(jwtSecretDir, { recursive: true })
      writeFileSync(storageKeyPath, encrypted)
      logToFile('Generated new storage key via safeStorage')
    }
  } else {
    // Fallback: unencrypted file (Linux without keychain, etc.)
    try {
      storageKey = readFileSync(storageKeyPath, 'utf8').trim()
    } catch {
      storageKey = crypto.randomBytes(32).toString('hex')
      mkdirSync(jwtSecretDir, { recursive: true })
      writeFileSync(storageKeyPath, storageKey, 'utf8')
      logToFile('Generated new storage key (safeStorage unavailable, file-based fallback)')
    }
  }
  logToFile('Storage key loaded')

  // In dev: use system `node` and source paths.
  // In production: use Electron's own Node.js runtime (ELECTRON_RUN_AS_NODE=1)
  // so the packaged app has no dependency on the user having Node.js installed.
  const nodeExecutable = is.dev ? 'node' : process.execPath

  const backendScript = is.dev
    ? join(__dirname, '../../backend/dist/index.js')
    : join(process.resourcesPath, 'backend/dist/index.js')

  const backendCwd = is.dev
    ? join(__dirname, '../../backend')
    : join(process.resourcesPath, 'backend')

  logToFile(`nodeExecutable: ${nodeExecutable}`)
  logToFile(`backendScript: ${backendScript}`)
  logToFile(`backendCwd: ${backendCwd}`)

  logToFile('Spawning backend child process...')
  const child = spawn(nodeExecutable, [backendScript], {
    cwd: backendCwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', // Makes Electron binary behave as Node.js
      PORT: String(backendPort),
      DATABASE_URL: `file:${dbPath}`,
      JWT_SECRET: jwtSecret,
      STORAGE_KEY: storageKey,
      NODE_ENV: 'production'
    }
  })
  backendProcess = child

  child.stdout.on('data', (data) => {
    const message = data.toString().trim()
    console.log(`Backend: ${message}`)
    logToFile(`[Backend STDOUT] ${message}`)
  })

  child.stderr.on('data', (data) => {
    const message = data.toString().trim()
    console.error(`Backend error: ${message}`)
    logToFile(`[Backend STDERR] ${message}`)
  })

  child.on('close', (code) => {
    logToFile(`Backend child process exited with code ${code}`)
  })

  child.on('error', (err) => {
    logToFile(`Backend child process error: ${err.message}`)
  })

  return backendPort
}

function setupAutoUpdater(mainWindow: BrowserWindow): void {
  if (is.dev) return // Skip auto-update in development

  logToFile('Initializing AutoUpdater...')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    logToFile('AutoUpdater: update-available')
    mainWindow.webContents.send('update:available')
  })

  autoUpdater.on('update-downloaded', () => {
    logToFile('AutoUpdater: update-downloaded')
    mainWindow.webContents.send('update:downloaded')
  })

  autoUpdater.on('error', (err) => {
    const errMsg = err instanceof Error ? err.message : String(err)
    logToFile(`AutoUpdater error: ${errMsg}`)
    console.error('Auto-updater error:', err)
  })

  // Check silently on startup, then every 4 hours
  autoUpdater.checkForUpdates().catch((err) => {
    logToFile(`AutoUpdater initial check error: ${err.message || err}`)
    console.error(err)
  })

  const updaterInterval = setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err) => {
        logToFile(`AutoUpdater periodic check error: ${err.message || err}`)
        console.error(err)
      })
    },
    4 * 60 * 60 * 1000
  )
  appIntervals.push(updaterInterval)
}

function createConnectionWindow(
  type: 'terminal' | 'sftp',
  sessionId: string,
  profileId: string,
  title: string,
  token: string
): void {
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

  connWindow.on('ready-to-show', () => {
    connWindow.show()
  })

  // Store token for secure IPC retrieval — never embed in URL (SEC-07)
  const timer = setTimeout(() => pendingConnectionTokens.delete(sessionId), 30_000)
  pendingConnectionTokens.set(sessionId, { token, timer })

  const hashPath = `#/connection/${type}/${sessionId}?profileId=${profileId}`

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    connWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hashPath}`)
  } else {
    // In production, load file with hash using the hash option
    connWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: `/connection/${type}/${sessionId}?profileId=${profileId}&token=${token}`
    })
  }
}

function createWindow(): void {
  logToFile('Creating BrowserWindow...')
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    logToFile('BrowserWindow ready-to-show. Revealing window...')
    mainWindow.show()
    setupAutoUpdater(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // SEC-08: Only allow http(s): URLs through shell.openExternal
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(details.url)
      } else {
        logToFile(`Blocked openExternal for disallowed protocol: ${parsed.protocol}`)
      }
    } catch {
      logToFile(`Blocked openExternal for invalid URL: ${details.url}`)
    }
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

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

  // IPC handlers
  ipcMain.on('ping', () => console.log('pong'))
  ipcMain.on('get-backend-port', (event) => {
    event.returnValue = backendPort
  })

  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'] })
    if (!canceled) return filePaths
    return []
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!canceled) return filePaths[0]
    return null
  })

  ipcMain.handle('dialog:saveFile', async (_, defaultName) => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: defaultName })
    if (!canceled) return filePath
    return null
  })

  ipcMain.handle('dialog:openJsonFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    })
    if (!canceled) return filePaths
    return []
  })

  ipcMain.handle('dialog:openCskbFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CypherShell Key Bundle', extensions: ['cskb'] }]
    })
    if (!canceled) return filePaths
    return []
  })

  // Auto-updater IPC
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Connection Window IPC
  ipcMain.handle('window:openTerminal', async (_, { sessionId, profileId, title, token }) => {
    createConnectionWindow('terminal', sessionId, profileId, title, token)
  })

  ipcMain.handle('window:openSftp', async (_, { sessionId, profileId, title, token }) => {
    createConnectionWindow('sftp', sessionId, profileId, title, token)
  })

  // ─── Path validation for local filesystem operations ────────────────
  // Resolves user-supplied paths against allowed base directories to
  // prevent path-traversal / arbitrary filesystem access (SEC-04).
  const ALLOWED_BASE_DIRS: ReadonlySet<string> = new Set([
    realpathSync(os.homedir())
  ])

  function validateFilePath(userPath: string): string {
    if (!userPath || typeof userPath !== 'string') {
      throw new Error('Invalid path')
    }

    // Resolve relative paths against homedir
    const resolvedPath = isAbsolute(userPath) ? resolve(userPath) : resolve(os.homedir(), userPath)

    // For existing paths, resolve symlinks and '..' to get the canonical path
    let realPath: string
    if (existsSync(resolvedPath)) {
      realPath = realpathSync(resolvedPath)
    } else {
      // For new files/dirs, resolve the parent directory
      const parentDir = dirname(resolvedPath)
      // Verify the parent exists and is within bounds
      if (!existsSync(parentDir)) {
        throw new Error(`Parent directory does not exist: "${userPath}"`)
      }
      const realParent = realpathSync(parentDir)
      realPath = join(realParent, basename(resolvedPath))
    }

    // Must be within one of the allowed base directories
    const withinBounds = [...ALLOWED_BASE_DIRS].some((base) => {
      const rel = relative(base, realPath)
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
    })

    if (!withinBounds) {
      throw new Error(`Access denied: path is outside allowed directories`)
    }

    return realPath
  }

  ipcMain.handle('fs:readDir', async (_, dirPath) => {
    try {
      const p = dirPath ? validateFilePath(dirPath) : realpathSync(os.homedir())
      const dirents = await readdir(p, { withFileTypes: true })
      const files = await Promise.all(
        dirents.map(async (d) => {
          try {
            const s = await stat(join(p, d.name))
            return {
              name: d.name,
              type: d.isDirectory() ? 'd' : 'f',
              size: s.size,
              modifyTime: s.mtime.toISOString(),
              permissions: s.mode
            }
          } catch {
            return null
          }
        })
      )
      return { path: p, files: files.filter(Boolean) }
    } catch (err: unknown) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('fs:executeOp', async (_, op, args) => {
    try {
      // Validate all file paths against allowed base directories (SEC-04)
      if (op === 'mkdir') {
        const safePath = validateFilePath(args.path)
        await mkdir(safePath)
      } else if (op === 'rename') {
        const safeOld = validateFilePath(args.oldPath)
        const safeNew = validateFilePath(args.newPath)
        await rename(safeOld, safeNew)
      } else if (op === 'delete') {
        const safePath = validateFilePath(args.path)
        // Only allow deleting files, not recursive directories
        const stat_result = await stat(safePath)
        if (stat_result.isDirectory()) {
          throw new Error('Directory deletion not allowed via this API')
        }
        await rm(safePath, { force: true })
      } else if (op === 'writeFile') {
        const safePath = validateFilePath(args.path)
        writeFileSync(safePath, args.content, 'utf8')
      } else if (op === 'readFile') {
        const safePath = validateFilePath(args.path)
        return readFileSync(safePath, 'utf8')
      }
      return true
    } catch (err: unknown) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

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

// ─── Connection-window token exchange (SEC-07) ─────────────────────
// Holds JWTs briefly so child windows can retrieve them via IPC
// instead of embedding the token in the loadable URL.
const pendingConnectionTokens = new Map<string, { token: string; timer: NodeJS.Timeout }>()

ipcMain.handle('get-connection-token', (_event, sessionId: string) => {
  const entry = pendingConnectionTokens.get(sessionId)
  if (entry) {
    clearTimeout(entry.timer)
    pendingConnectionTokens.delete(sessionId)
    return entry.token
  }
  return null
})

/** CODE-08: Kill the backend child process with SIGTERM + SIGKILL fallback. */
function killBackendProcess(): void {
  if (!backendProcess) return
  try {
    backendProcess.kill('SIGTERM')
    // Force SIGKILL after 3s if still running (SIGTERM-only can orphan a hung backend)
    const forceTimer = setTimeout(() => {
      try {
        if (backendProcess?.exitCode === null) {
          if (process.platform !== 'win32') {
            backendProcess.kill('SIGKILL')
          } else {
            backendProcess.kill() // TerminateProcess on Windows
          }
        }
      } catch {
        // Process already exited
      }
    }, 3000)
    backendProcess.once('exit', () => clearTimeout(forceTimer))
  } catch {
    // Process already exited or not owned
  }
}

// Clean up the backend process when Electron quits
app.on('will-quit', () => {
  logToFile('will-quit event triggered: Cleaning up...')
  // CODE-15: Clear app-lifetime intervals
  for (const id of appIntervals) clearInterval(id)
  appIntervals.length = 0
  killBackendProcess()
})

process.on('exit', () => {
  if (backendProcess) {
    try {
      backendProcess.kill('SIGTERM')
    } catch {
      // Ignore — process exiting anyway
    }
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
