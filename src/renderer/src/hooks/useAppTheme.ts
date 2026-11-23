import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

/**
 * Applies the app theme (UX-02, BL-35): toggles the `light` class on <html>, which main.css maps
 * to the light colours. "system" follows the OS and reacts when it changes.
 *
 * The theme comes from the shared `['config']` query, so saving it in Settings (which
 * invalidates that query) restyles the app at once instead of after the next launch.
 */
export function useAppTheme(): void {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: async () => (await api.get<{ theme?: string }>('/config')).data
  })
  const theme = data?.theme || 'dark'

  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'system') {
      root.classList.toggle('light', theme === 'light')
      return undefined
    }
    const query = window.matchMedia('(prefers-color-scheme: light)')
    root.classList.toggle('light', query.matches)
    const onChange = (event: MediaQueryListEvent): void => {
      root.classList.toggle('light', event.matches)
    }
    query.addEventListener('change', onChange)
    return (): void => query.removeEventListener('change', onChange)
  }, [theme])
}
