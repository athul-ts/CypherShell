import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  backendPort: ipcRenderer.sendSync('get-backend-port'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  saveFileDialog: (defaultName: string) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  openJsonFileDialog: () => ipcRenderer.invoke('dialog:openJsonFile'),
  openCskbFileDialog: () => ipcRenderer.invoke('dialog:openCskbFile'),
  appVersion: process.env.APP_VERSION || '1.0.0',
  openTerminalWindow: (sessionId: string, profileId: string, title: string, token: string) => 
    ipcRenderer.invoke('window:openTerminal', { sessionId, profileId, title, token }),
  openSftpWindow: (sessionId: string, profileId: string, title: string, token: string) => 
    ipcRenderer.invoke('window:openSftp', { sessionId, profileId, title, token }),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateAvailable: (cb: () => void) => {
    ipcRenderer.on('update:available', cb)
    return () => ipcRenderer.removeListener('update:available', cb)
  },
  onUpdateDownloaded: (cb: () => void) => {
    ipcRenderer.on('update:downloaded', cb)
    return () => ipcRenderer.removeListener('update:downloaded', cb)
  },
  readLocalDir: (dirPath?: string) => ipcRenderer.invoke('fs:readDir', dirPath),
  executeLocalFileOp: (op: string, args: any) => ipcRenderer.invoke('fs:executeOp', op, args)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
