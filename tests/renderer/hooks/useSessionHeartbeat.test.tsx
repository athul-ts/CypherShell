/** [FR-03.5][BL-11] Open views renew their SSH session lease and notice when it ends. */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat'
import { api } from '@/lib/api'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('[BL-11] useSessionHeartbeat', () => {
  it('polls GET /sessions/:id and reports a live session as not ended', async () => {
    mockApi.get.mockResolvedValue({ data: { alive: true } })
    const { result } = renderHook(() => useSessionHeartbeat('session-1'), { wrapper })
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/sessions/session-1'))
    expect(result.current.ended).toBe(false)
  })

  it('reports ended once the backend says the session is gone', async () => {
    mockApi.get.mockResolvedValue({ data: { alive: false } })
    const { result } = renderHook(() => useSessionHeartbeat('session-2'), { wrapper })
    await waitFor(() => expect(result.current.ended).toBe(true))
  })

  it('does not poll without a session or while disabled', () => {
    renderHook(() => useSessionHeartbeat(null), { wrapper })
    renderHook(() => useSessionHeartbeat('session-3', false), { wrapper })
    expect(mockApi.get).not.toHaveBeenCalled()
  })
})
