import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// ── Axios API client mock (named export `api`) ──────────────────────────────
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  },
  setUnauthorizedHandler: vi.fn(),
  LAUNCH_SECRET_HEADER: 'X-CypherShell-Launch'
}))

// ── Preload bridge (window.api) mock ────────────────────────────────────────
// Mirrors src/preload/index.d.ts. Subscriptions return an unsubscribe function.
Object.defineProperty(window, 'api', {
  value: {
    backendPort: 3001,
    launchSecret: 'renderer-test-launch-secret', // BL-17
    appVersion: '0.0.0-test',
    logRendererError: vi.fn().mockResolvedValue(undefined), // BL-43
    // BL-47: grants, never local paths
    pickUploadFile: vi.fn().mockResolvedValue(null),
    pickDownloadTarget: vi.fn().mockResolvedValue(null),
    grantDroppedFile: vi.fn((file: File) =>
      Promise.resolve({ grant: 'd'.repeat(32), name: file.name })
    ),
    saveTextFile: vi.fn().mockResolvedValue(null), // BL-22
    openTextFile: vi.fn().mockResolvedValue(null), // BL-22
    onUpdateAvailable: vi.fn(() => () => {}),
    onUpdateDownloaded: vi.fn(() => () => {}),
    onBackendRestarted: vi.fn(() => () => {}),
    onAppLocked: vi.fn(() => () => {}), // BL-18
    installUpdate: vi.fn(),
    openDownloadPage: vi.fn(), // BL-24
    openTerminalWindow: vi.fn(),
    openSftpWindow: vi.fn(),
    getConnectionToken: vi.fn().mockResolvedValue(null), // BL-20
    readLocalDir: vi.fn().mockResolvedValue({
      path: '/home/tester',
      parent: null,
      grant: 'f'.repeat(32),
      files: []
    })
  },
  writable: true,
  configurable: true
})

// ── Toast (sonner) mock ──────────────────────────────────────────────────────
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  },
  Toaster: () => null
}))

// ── Reset mocks between tests ────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
})
