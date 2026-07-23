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
  }
}))

// ── Preload bridge (window.api) mock ────────────────────────────────────────
Object.defineProperty(window, 'api', {
  value: {
    backendPort: 3001,
    openFileDialog: vi.fn().mockResolvedValue(null),
    saveFileDialog: vi.fn().mockResolvedValue(null),
    onUpdateAvailable: vi.fn(),
    onUpdateDownloaded: vi.fn(),
    installUpdate: vi.fn(),
    readLocalDir: vi.fn().mockResolvedValue({ entries: [] }),
    executeLocalFileOp: vi.fn().mockResolvedValue({ success: true })
  },
  writable: true,
  configurable: true
})

// ── Toast (sonner) mock ──────────────────────────────────────────────────────
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  },
  Toaster: () => null
}))

// ── Reset mocks between tests ────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
})
