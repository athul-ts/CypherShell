import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

/**
 * How often an open tab or window renews its session lease (BL-11) — well
 * under the backend's 60-second timeout for sessions nothing is using.
 */
export const SESSION_HEARTBEAT_MS = 15_000

/**
 * Keeps an SSH session alive while the calling view is open, and reports when
 * it has ended. Each poll of `GET /api/sessions/:id` renews the session's
 * lease in the backend, so a Profile Detail tab or SFTP window holds the
 * session even when no terminal is open (FR-03.5).
 */
export function useSessionHeartbeat(sessionId: string | null, enabled = true): { ended: boolean } {
  const { data } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      const res = await api.get<{ alive: boolean }>(`/sessions/${sessionId}`)
      return res.data
    },
    enabled: !!sessionId && enabled,
    refetchInterval: SESSION_HEARTBEAT_MS,
    // Keep renewing while the window is minimised or in the background.
    refetchIntervalInBackground: true,
    retry: false
  })
  return { ended: data?.alive === false }
}
