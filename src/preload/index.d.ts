declare global {
  /** One entry of the local directory listing (BL-44; FR-04 local pane). */
  interface LocalDirEntry {
    name: string
    type: 'd' | 'f'
    size: number
    modifyTime: string
    permissions: number
  }

  /** BL-47: a local file the user picked, as the page sees it — an opaque grant and a name, never a path. */
  interface PickedLocalFile {
    grant: string
    name: string
  }

  /** BL-47: the local pane's listing; `grant` is a read-only grant for the folder, `parent` is null at home. */
  interface LocalDirListing {
    path: string
    parent: string | null
    grant: string
    files: LocalDirEntry[]
  }

  interface Window {
    api: {
      backendPort: number
      /** BL-17: per-launch secret — the `X-CypherShell-Launch` header and the terminal WebSocket's `launch`. */
      launchSecret: string
      /** BL-43: writes an error report to app.log (validated, capped and rate-limited by main). */
      logRendererError: (context: string, message: string) => Promise<void>
      /** BL-47: the native Open dialog (SFTP windows only). Resolves with a grant, or null if cancelled. */
      pickUploadFile: () => Promise<PickedLocalFile | null>
      /** BL-47: the native Save dialog with a cleaned name, in the folder of `folder` (a listing grant) when given. */
      pickDownloadTarget: (request: {
        name: string
        folder?: string
      }) => Promise<PickedLocalFile | null>
      /** BL-47: a file dropped from the OS, granted by main; the path never reaches the page. */
      grantDroppedFile: (file: File) => Promise<PickedLocalFile | null>
      /** BL-22: main shows the save dialog and writes `content`. Resolves with the path, or null if cancelled. */
      saveTextFile: (request: {
        kind: 'json' | 'cskb' | 'pub' | 'csv' // csv: BL-28
        defaultName: string
        content: string
      }) => Promise<string | null>
      /** BL-22: main shows the open dialog. Resolves with the file's name and UTF-8 content, or null. */
      openTextFile: (request: {
        kind: 'json' | 'cskb' | 'pub' | 'csv'
      }) => Promise<{ name: string; content: string } | null>
      appVersion: string
      installUpdate: () => Promise<void>
      /** BL-24: opens the GitHub Releases page (the macOS manual update). */
      openDownloadPage: () => Promise<void>
      /** `manual` (BL-24): the update is downloaded from the Releases page, not installed in-app. */
      onUpdateAvailable: (cb: (info: { version: string; manual: boolean }) => void) => () => void
      onUpdateDownloaded: (cb: () => void) => () => void
      /** BL-16: fires after the main process restarted a crashed backend. Returns an unsubscribe. */
      onBackendRestarted: (cb: () => void) => () => void
      /** BL-18: fires when the app locked. Returns an unsubscribe. */
      onAppLocked: (cb: () => void) => () => void
      openTerminalWindow: (
        sessionId: string,
        profileId: string,
        title: string,
        token: string
      ) => void
      openSftpWindow: (sessionId: string, profileId: string, title: string, token: string) => void
      readLocalDir: (dirPath?: string) => Promise<LocalDirListing>
      /** SEC-07 / BL-20: this connection window's one-time token, or null. */
      getConnectionToken: () => Promise<string | null>
    }
  }
}

export {}
