import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { spawn } from 'child_process'
import portfinder from 'portfinder'
import iconPng from '../../resources/icon.png?asset'
import iconIco from '../../build/icon.ico?asset'
const icon = process.platform === 'win32' ? iconIco : iconPng
import { writeFileSync, appendFileSync, readFileSync } from 'fs'
import { stat, readdir, mkdir, rename, rm } from 'fs/promises'
import * as os from 'os'

let backendPort = 4000;
let backendProcess: any = null;

function logToFile(message: string) {
  try {
    const logPath = join(app.getPath('userData'), 'app.log');
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] ${message}\n`;
    appendFileSync(logPath, formattedMessage);
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

// Initialize log file
try {
  const logPath = join(app.getPath('userData'), 'app.log');
  writeFileSync(logPath, `=== APP STARTUP: ${new Date().toISOString()} ===\n`);
  console.log(`[Main] Diagnostic log file initialized at: ${logPath}`);
} catch (err) {
  console.error('Failed to initialize log file:', err);
}

async function startBackend() {
  logToFile('Attempting to find an open port for the backend...');
  backendPort = await portfinder.getPortPromise({ port: 4000 });
  const dbPath = join(app.getPath('userData'), 'sshclient.db');
  logToFile(`Using backend port: ${backendPort}`);
  logToFile(`Using SQLite database path: ${dbPath}`);

  // In dev: use system `node` and source paths.
  // In production: use Electron's own Node.js runtime (ELECTRON_RUN_AS_NODE=1)
  // so the packaged app has no dependency on the user having Node.js installed.
  const nodeExecutable = is.dev ? 'node' : process.execPath;

  const backendScript = is.dev
    ? join(__dirname, '../../backend/dist/index.js')
    : join(process.resourcesPath, 'backend/dist/index.js');

  const backendCwd = is.dev
    ? join(__dirname, '../../backend')
    : join(process.resourcesPath, 'backend');

  logToFile(`nodeExecutable: ${nodeExecutable}`);
  logToFile(`backendScript: ${backendScript}`);
  logToFile(`backendCwd: ${backendCwd}`);

  logToFile('Spawning backend child process...');
  const child = spawn(nodeExecutable, [backendScript], {
    cwd: backendCwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',    // Makes Electron binary behave as Node.js
      PORT: String(backendPort),
      DATABASE_URL: `file:${dbPath}`,
      NODE_ENV: 'production',
    },
  });
  backendProcess = child;

  child.stdout.on('data', data => {
    const message = data.toString().trim();
    console.log(`Backend: ${message}`);
    logToFile(`[Backend STDOUT] ${message}`);
  });

  child.stderr.on('data', data => {
    const message = data.toString().trim();
    console.error(`Backend error: ${message}`);
    logToFile(`[Backend STDERR] ${message}`);
  });

  child.on('close', (code) => {
    logToFile(`Backend child process exited with code ${code}`);
  });

  child.on('error', (err) => {
    logToFile(`Backend child process error: ${err.message}`);
  });

  return backendPort;
}

function setupAutoUpdater(mainWindow: BrowserWindow): void {
  if (is.dev) return // Skip auto-update in development

  logToFile('Initializing AutoUpdater...');
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    logToFile('AutoUpdater: update-available');
    mainWindow.webContents.send('update:available')
  })

  autoUpdater.on('update-downloaded', () => {
    logToFile('AutoUpdater: update-downloaded');
    mainWindow.webContents.send('update:downloaded')
  })

  autoUpdater.on('error', (err) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    logToFile(`AutoUpdater error: ${errMsg}`);
    console.error('Auto-updater error:', err)
  })

  // Check silently on startup, then every 4 hours
  autoUpdater.checkForUpdates().catch((err) => {
    logToFile(`AutoUpdater initial check error: ${err.message || err}`);
    console.error(err);
  });

  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      logToFile(`AutoUpdater periodic check error: ${err.message || err}`);
      console.error(err);
    });
  }, 4 * 60 * 60 * 1000);
}

function createConnectionWindow(type: 'terminal' | 'sftp', sessionId: string, profileId: string, title: string, token: string): void {
  logToFile(`Creating connection window of type: ${type} for sessionId: ${sessionId}, profileId: ${profileId}`);
  
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
      sandbox: false
    }
  });

  connWindow.on('ready-to-show', () => {
    connWindow.show();
  });

  const hashPath = `#/connection/${type}/${sessionId}?profileId=${profileId}&token=${token}`;
  
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    connWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hashPath}`);
  } else {
    // In production, load file with hash using the hash option
    connWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: `/connection/${type}/${sessionId}?profileId=${profileId}&token=${token}`
    });
  }
}

function createWindow(): void {
  logToFile('Creating BrowserWindow...');
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    logToFile('BrowserWindow ready-to-show. Revealing window...');
    mainWindow.show()
    setupAutoUpdater(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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
  logToFile('Electron app whenReady triggered');
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.cyphershell.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Start the backend before creating the window
  logToFile('Starting backend service...');
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
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    })
    if (!canceled) return filePaths
    return []
  })

  ipcMain.handle('dialog:openCskbFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CypherShell Key Bundle', extensions: ['cskb'] }],
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
    createConnectionWindow('terminal', sessionId, profileId, title, token);
  })

  ipcMain.handle('window:openSftp', async (_, { sessionId, profileId, title, token }) => {
    createConnectionWindow('sftp', sessionId, profileId, title, token);
  })

  ipcMain.handle('fs:readDir', async (_, dirPath) => {
    try {
      const p = dirPath || os.homedir();
      const dirents = await readdir(p, { withFileTypes: true });
      const files = await Promise.all(dirents.map(async d => {
        try {
          const s = await stat(join(p, d.name));
          return {
            name: d.name,
            type: d.isDirectory() ? 'd' : 'f',
            size: s.size,
            modifyTime: s.mtime.toISOString(),
            permissions: s.mode
          };
        } catch (e) {
          return null;
        }
      }));
      return { path: p, files: files.filter(Boolean) };
    } catch (err: any) {
      throw new Error(err.message);
    }
  });

  ipcMain.handle('fs:executeOp', async (_, op, args) => {
    try {
      if (op === 'mkdir') await mkdir(args.path);
      else if (op === 'rename') await rename(args.oldPath, args.newPath);
      else if (op === 'delete') await rm(args.path, { recursive: true, force: true });
      else if (op === 'writeFile') writeFileSync(args.path, args.content, 'utf8');
      else if (op === 'readFile') return readFileSync(args.path, 'utf8');
      return true;
    } catch (err: any) {
      throw new Error(err.message);
    }
  });

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
  logToFile('All windows closed event triggered');
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up the backend process when Electron quits
app.on('will-quit', () => {
  if (backendProcess) {
    logToFile('will-quit event triggered: Killing backend process...');
    try {
      backendProcess.kill();
    } catch (e) {
      console.error('Failed to kill backend:', e);
    }
  }
});

process.on('exit', () => {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch (e) {
      // Ignore
    }
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
