import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      backendPort: number
      openFileDialog: () => Promise<string[]>
      openDirectoryDialog: () => Promise<string | null>
      saveFileDialog: (defaultName: string) => Promise<string | null>
      openJsonFileDialog: () => Promise<string[]>
      openCskbFileDialog: () => Promise<string[]>
      appVersion: string
      installUpdate: () => Promise<void>
      onUpdateAvailable: (cb: () => void) => () => void
      onUpdateDownloaded: (cb: () => void) => () => void
      openTerminalWindow: (sessionId: string, profileId: string, title: string, token: string) => void
      openSftpWindow: (sessionId: string, profileId: string, title: string, token: string) => void
      readLocalDir: (dirPath?: string) => Promise<{ path: string; files: unknown[] }>
      executeLocalFileOp: (op: string, args: Record<string, unknown>) => Promise<unknown>
      getConnectionToken: (sessionId: string) => Promise<string | null>
    }
  }
}
