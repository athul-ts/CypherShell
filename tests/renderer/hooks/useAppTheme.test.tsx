/**
 * [UX-02][§11.2][BL-35] The app theme follows the saved config.
 *
 * Regression: the theme was read once when the app mounted, so choosing Light in
 * Settings changed nothing until the next launch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAppTheme } from '@/hooks/useAppTheme'
import { api } from '@/lib/api'

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> }
const isLight = (): boolean => document.documentElement.classList.contains('light')

function setup(): {
  client: QueryClient
  wrapper: (props: { children: ReactNode }) => React.JSX.Element
} {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

beforeEach(() => document.documentElement.classList.remove('light'))
afterEach(() => {
  document.documentElement.classList.remove('light')
  vi.unstubAllGlobals()
})

describe('[BL-35] useAppTheme', () => {
  it('"light" adds the light class and "dark" leaves it off', async () => {
    mockApi.get.mockResolvedValue({ data: { theme: 'light' } })
    const light = setup()
    renderHook(() => useAppTheme(), { wrapper: light.wrapper })
    await waitFor(() => expect(isLight()).toBe(true))

    document.documentElement.classList.remove('light')
    mockApi.get.mockResolvedValue({ data: { theme: 'dark' } })
    const dark = setup()
    renderHook(() => useAppTheme(), { wrapper: dark.wrapper })
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2))
    expect(isLight()).toBe(false)
  })

  it('restyles at once when Settings saves a new theme (the config query is invalidated)', async () => {
    mockApi.get.mockResolvedValue({ data: { theme: 'dark' } })
    const { client, wrapper } = setup()
    renderHook(() => useAppTheme(), { wrapper })
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled())
    expect(isLight()).toBe(false)

    mockApi.get.mockResolvedValue({ data: { theme: 'light' } })
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['config'] })
    })
    await waitFor(() => expect(isLight()).toBe(true))

    mockApi.get.mockResolvedValue({ data: { theme: 'dark' } })
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['config'] })
    })
    await waitFor(() => expect(isLight()).toBe(false))
  })

  it('"system" follows the OS preference and reacts when it changes', async () => {
    let listener: ((event: MediaQueryListEvent) => void) | null = null
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => (listener = fn),
      removeEventListener: () => (listener = null)
    }))
    mockApi.get.mockResolvedValue({ data: { theme: 'system' } })
    const { wrapper } = setup()
    renderHook(() => useAppTheme(), { wrapper })

    await waitFor(() => expect(isLight()).toBe(true)) // the OS prefers light
    act(() => listener?.({ matches: false } as MediaQueryListEvent))
    expect(isLight()).toBe(false)
    act(() => listener?.({ matches: true } as MediaQueryListEvent))
    expect(isLight()).toBe(true)
  })
})
