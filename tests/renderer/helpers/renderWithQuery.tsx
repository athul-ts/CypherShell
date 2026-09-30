import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'

export function renderWithQuery(ui: React.ReactElement): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0
      }
    }
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
