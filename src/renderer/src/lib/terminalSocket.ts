/** Close code the backend sends to every terminal when the app locks (BL-18). Never reconnected. */
export const APP_LOCKED_CLOSE_CODE = 4001

/** The shell ended normally (the user typed `exit`); a reconnect would open a new shell (BL-29). */
export const SHELL_ENDED_CLOSE_CODE = 1000
/** The SSH session no longer exists; a reconnect cannot succeed (BL-29). */
export const SESSION_GONE_CLOSE_CODE = 1008

/** The backend could not restore the SSH connection; the session is gone (BL-41). */
export const SSH_LOST_CLOSE_CODE = 4002

/** Whether an unexpected close should be retried (FR-02.6). Only abnormal drops are. */
export function shouldReconnect(code: number): boolean {
  return (
    code !== SHELL_ENDED_CLOSE_CODE &&
    code !== SESSION_GONE_CLOSE_CODE &&
    code !== APP_LOCKED_CLOSE_CODE &&
    code !== SSH_LOST_CLOSE_CODE
  )
}

/**
 * The terminal WebSocket URL. WebSockets cannot set headers, so the JWT
 * (SEC-03) and the per-launch secret (BL-17) travel as query parameters.
 */
export function terminalSocketUrl(
  port: number,
  sessionId: string,
  token: string | null,
  launchSecret: string | undefined
): string {
  const params = new URLSearchParams()
  if (token) params.set('token', token)
  if (launchSecret) params.set('launch', launchSecret)
  const query = params.toString()
  return `ws://127.0.0.1:${port}/ws/terminal/${encodeURIComponent(sessionId)}${query ? `?${query}` : ''}`
}

/**
 * Link handler for xterm's WebLinksAddon (BL-21). The addon's default opens
 * a blank window and then navigates it, which the main process now refuses;
 * passing the URL lets main open it in the system browser.
 */
export function openTerminalLink(_event: MouseEvent, uri: string): void {
  window.open(uri, '_blank', 'noopener')
}
