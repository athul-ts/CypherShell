import { contextBridge, ipcRenderer, webUtils } from 'electron'

/** BL-22: what a text export or import is for; it only selects the dialog's file filter. */
type TextFileKind = 'json' | 'cskb' | 'pub' | 'csv' // csv: audit-log export (BL-28)

interface UpdateInfo {
  version: string
  /** BL-24: true on macOS, where the update is downloaded from the Releases page. */
  manual: boolean
}

/**
 * Subscribes `cb` to a main → renderer event and returns an unsubscribe.
 * The IpcRendererEvent itself never reaches the page: its `sender` is
 * ipcRenderer, a passthrough to every IPC channel (BL-22).
 */
function subscribe(channel: string, cb: () => void): () => void {
  const listener = (): void => cb()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// The renderer's whole bridge. There is no generic ipcRenderer passthrough and
// no call that reads or writes a file path the page supplies (BL-22).
const api = {
  backendPort: ipcRenderer.sendSync('get-backend-port') as number,
  // BL-17: sent on every API request and with the terminal WebSocket
  launchSecret: ipcRenderer.sendSync('get-launch-secret') as string,
  appVersion: ipcRenderer.sendSync('get-app-version') as string,
  // BL-43: error reports go to app.log in the main process, not to the console
  logRendererError: (context: string, message: string): Promise<void> =>
    ipcRenderer.invoke('log:rendererError', context, message),
  // BL-47 / ADR-006: local files for SFTP transfers. The page gets opaque grants from main and
  // sends those to the backend — never a local path. Served to SFTP windows only.
  pickUploadFile: () => ipcRenderer.invoke('sftp:pickUploadFile'),
  pickDownloadTarget: (request: { name: string; folder?: string }) =>
    ipcRenderer.invoke('sftp:pickDownloadTarget', request),
  readLocalDir: (dirPath?: string) => ipcRenderer.invoke('sftp:readLocalDir', dirPath),
  // A file dropped from the OS. The path is read here, from the real File (page script cannot
  // build one), goes straight to main and is never returned to the page (File.path was removed
  // in Electron 32).
  grantDroppedFile: (file: File): Promise<unknown> => {
    let filePath = ''
    try {
      filePath = webUtils.getPathForFile(file)
    } catch {
      return Promise.resolve(null) // not a File
    }
    if (!filePath) return Promise.resolve(null) // a File made in JavaScript has no path
    return ipcRenderer.invoke('sftp:grantDroppedFile', filePath)
  },
  // BL-22: main runs the dialog and does the IO
  saveTextFile: (request: { kind: TextFileKind; defaultName: string; content: string }) =>
    ipcRenderer.invoke('dialog:saveTextFile', request),
  openTextFile: (request: { kind: TextFileKind }) =>
    ipcRenderer.invoke('dialog:openTextFile', request),
  openTerminalWindow: (sessionId: string, profileId: string, title: string, token: string) =>
    ipcRenderer.invoke('window:openTerminal', { sessionId, profileId, title, token }),
  openSftpWindow: (sessionId: string, profileId: string, title: string, token: string) =>
    ipcRenderer.invoke('window:openSftp', { sessionId, profileId, title, token }),
  // SEC-07 / BL-20: main hands each connection window its own token, once
  getConnectionToken: () => ipcRenderer.invoke('get-connection-token'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  // BL-24: the Releases page, for the macOS manual update
  openDownloadPage: () => ipcRenderer.invoke('updater:openDownloadPage'),
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => {
    const listener = (_event: unknown, info: UpdateInfo): void =>
      cb({ version: String(info?.version ?? ''), manual: info?.manual === true })
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },
  onUpdateDownloaded: (cb: () => void) => subscribe('update:downloaded', cb),
  // BL-16: the main process restarted a crashed backend; tokens must be re-issued.
  onBackendRestarted: (cb: () => void) => subscribe('backend:restarted', cb),
  // BL-18: the app locked (idle timeout or a lock request)
  onAppLocked: (cb: () => void) => subscribe('app:locked', cb)
}

// Use `contextBridge` APIs to expose the bridge to the renderer only if
// context isolation is enabled, otherwise just add it to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    // The bridge does not exist yet when this fails, so nothing else can report it.
    // eslint-disable-next-line no-console
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
