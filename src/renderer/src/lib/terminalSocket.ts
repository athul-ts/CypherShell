/** Close code the backend sends to every terminal when the app locks (BL-18). Never reconnected. */
export const APP_LOCKED_CLOSE_CODE = 4001

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
