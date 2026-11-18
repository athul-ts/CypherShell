/**
 * [FR-08.5][BL-32] The Logs page asks the API for one filtered page at a time
 * instead of fetching 100 entries and filtering them in the browser.
 */
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../helpers/renderWithQuery'
import Logs from '@/pages/Logs'
import { api } from '@/lib/api'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

function entry(id: number): object {
  return {
    id: `log-${id}`,
    type: 'disconnection',
    detail: `Disconnected: closed by user (${id})`,
    profileName: 'Alpha',
    timestamp: '2026-11-18T10:00:00.000Z',
    errorMessage: null,
    success: true
  }
}

/** Answers GET /audit like the backend: the requested page of a 60-entry log. */
function serve60(): void {
  mockApi.get.mockImplementation(async (url: string, config?: { params: { page: number } }) => {
    if (url !== '/audit') return { data: [] }
    const page = config?.params.page ?? 1
    return { data: { items: [entry(page)], total: 60, page, pageSize: 25 } }
  })
}

const auditParams = (): Record<string, unknown>[] =>
  mockApi.get.mock.calls.filter(([url]) => url === '/audit').map(([, c]) => c.params)

describe('[FR-08.5][BL-32] Logs paging and filters', () => {
  it('requests page 1 and shows the range and page count', async () => {
    serve60()
    renderWithQuery(<Logs />)

    expect(await screen.findByText('Showing 1–25 of 60')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(auditParams()[0]).toEqual({ page: 1, pageSize: 25 })
  })

  it('Next and Previous move between pages', async () => {
    serve60()
    renderWithQuery(<Logs />)
    await screen.findByText('Page 1 of 3')
    expect(screen.getByLabelText('Previous page')).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Next page'))
    expect(await screen.findByText('Showing 26–50 of 60')).toBeInTheDocument()
    expect(auditParams().at(-1)).toMatchObject({ page: 2 })

    fireEvent.click(screen.getByLabelText('Next page'))
    expect(await screen.findByText('Showing 51–60 of 60')).toBeInTheDocument()
    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })

  it('offers "Disconnection" and sends the type, going back to page 1', async () => {
    serve60()
    renderWithQuery(<Logs />)
    await screen.findByText('Page 1 of 3')
    fireEvent.click(screen.getByLabelText('Next page'))
    await screen.findByText('Page 2 of 3')

    fireEvent.change(screen.getByDisplayValue('All Types'), { target: { value: 'disconnection' } })

    await waitFor(() =>
      expect(auditParams().at(-1)).toMatchObject({ page: 1, type: 'disconnection' })
    )
  })

  it('sends the search text after typing stops', async () => {
    serve60()
    renderWithQuery(<Logs />)
    await screen.findByText('Page 1 of 3')

    fireEvent.change(screen.getByPlaceholderText('Search logs...'), { target: { value: 'alp' } })
    fireEvent.change(screen.getByPlaceholderText('Search logs...'), { target: { value: 'alpha' } })

    await waitFor(() => expect(auditParams().at(-1)).toMatchObject({ q: 'alpha', page: 1 }))
    expect(auditParams().some((p) => p.q === 'alp')).toBe(false) // intermediate text is not queried
  })

  it('sends a "from" date for a time range', async () => {
    serve60()
    renderWithQuery(<Logs />)
    await screen.findByText('Page 1 of 3')

    fireEvent.change(screen.getByDisplayValue('All Time'), { target: { value: 'week' } })

    await waitFor(() => expect(auditParams().at(-1)).toHaveProperty('from'))
    const from = new Date(auditParams().at(-1)?.from as string).getTime()
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    expect(Math.abs(from - sevenDaysAgo)).toBeLessThan(60_000)
  })
})
