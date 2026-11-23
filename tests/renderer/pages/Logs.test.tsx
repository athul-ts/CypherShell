/// <reference types="vitest/jsdom" />
/**
 * [FR-08.6][BL-28] Export CSV fetches the CSV through the API client (so the
 * JWT and launch secret are sent) and saves it with the dialog-bound
 * `saveTextFile`.
 *
 * Regression: the button set `window.location.href` to the export URL — a
 * request without the JWT, and since BL-21 a navigation that main blocks — so
 * it did nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { toast } from 'sonner'
import { renderWithQuery } from '../helpers/renderWithQuery'
import Logs from '@/pages/Logs'
import { api } from '@/lib/api'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }
const bridge = window.api as unknown as { saveTextFile: ReturnType<typeof vi.fn> }
const mockToast = toast as unknown as {
  success: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

const CSV =
  'Timestamp,Type,Profile,Host,Detail,Success,Error,Size\n' +
  '2026-11-11T19:00:00.000Z,connection,"web ""prod""","web.local","Connected successfully",Yes,"",'

/** Navigations the page attempted. jsdom reports them instead of navigating. */
let navigations: string[] = []
function recordNavigation(error: Error): void {
  if (/navigation/i.test(error.message)) navigations.push(error.message)
}

beforeEach(() => {
  navigations = []
  jsdom.virtualConsole.on('jsdomError', recordNavigation)
  // 00:30 on 12 November, local time. East of UTC it is still 11 November in
  // UTC, so a name built from the UTC date fails there.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 12, 0, 30))
})

afterEach(() => {
  jsdom.virtualConsole.off('jsdomError', recordNavigation)
  vi.useRealTimers()
})

function renderLogs(exportResponse: () => Promise<unknown>): void {
  mockApi.get.mockImplementation((url: string) =>
    url === '/audit/export' ? exportResponse() : Promise.resolve({ data: [] })
  )
  renderWithQuery(<Logs />)
}

function clickExport(): void {
  fireEvent.click(screen.getByRole('button', { name: /export csv/i }))
}

describe('[FR-08.6][BL-28] Export CSV (Logs)', () => {
  it('fetches the CSV through the API client and saves it with saveTextFile, without navigating', async () => {
    bridge.saveTextFile.mockResolvedValue('D:\\exports\\cyphershell-audit-2026-11-12.csv')
    renderLogs(() => Promise.resolve({ data: CSV }))
    clickExport()
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Audit logs exported.'))
    expect(mockApi.get).toHaveBeenCalledWith('/audit/export', { responseType: 'text' })
    expect(bridge.saveTextFile).toHaveBeenCalledWith({
      kind: 'csv',
      defaultName: 'cyphershell-audit-2026-11-12.csv',
      content: CSV
    })
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(navigations).toEqual([])
  })

  it('a cancelled save shows no toast', async () => {
    bridge.saveTextFile.mockResolvedValue(null)
    renderLogs(() => Promise.resolve({ data: CSV }))
    clickExport()
    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: /export csv/i })).toBeEnabled())
    expect(bridge.saveTextFile).toHaveBeenCalledTimes(1)
    expect(mockToast.success).not.toHaveBeenCalled()
    expect(mockToast.error).not.toHaveBeenCalled()
  })

  it('a failed request shows an error toast and opens no dialog', async () => {
    renderLogs(() => Promise.reject(new Error('Request failed with status code 500')))
    clickExport()
    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        'Export failed: Request failed with status code 500'
      )
    )
    expect(bridge.saveTextFile).not.toHaveBeenCalled()
    expect(navigations).toEqual([])
  })

  it('a save refused by the main process shows its reason', async () => {
    bridge.saveTextFile.mockRejectedValue(
      new Error(
        "Error invoking remote method 'dialog:saveTextFile': Error: File is too large (limit 5 MB)"
      )
    )
    renderLogs(() => Promise.resolve({ data: CSV }))
    clickExport()
    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('Export failed: File is too large (limit 5 MB)')
    )
    expect(mockToast.success).not.toHaveBeenCalled()
  })
})
