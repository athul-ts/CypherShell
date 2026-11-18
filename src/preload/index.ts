import { contextBridge, ipcRenderer } from 'electron'

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
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  saveFileDialog: (defaultName: string) => ipcRenderer.invoke('dialog:saveFile', defaultName),
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
  readLocalDir: (dirPath?: string) => ipcRenderer.invoke('fs:readDir', dirPath),
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
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
