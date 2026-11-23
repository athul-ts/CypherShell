/**
 * Reports an error to the main process, which writes it to app.log (BL-43). The renderer
 * never logs to the console: a packaged app has no console, and app.log is where a user
 * looks when something went wrong. Never throws.
 */
export function reportError(context: string, err: unknown): void {
  try {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
    void Promise.resolve(window.api.logRendererError(context, message ?? String(err))).catch(
      () => {}
    )
  } catch {
    // Reporting must never break the feature that failed.
  }
}
