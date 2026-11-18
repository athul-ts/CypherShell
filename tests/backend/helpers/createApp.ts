/**
 * The real backend app (backend/src/app.ts) with rate limits disabled, so
 * tests exercise production routing, CORS, the caller checks and the error
 * handler without the 5-attempts-per-minute unlock limit throttling them.
 * No listen(), no WebSocket server and no background jobs — tests start those
 * explicitly.
 */
import type { Express } from 'express'
import { createApp as createBackendApp } from '../../../backend/src/app'

/** BL-17: the launch secret the backend tests run with (vitest.config.ts → `LAUNCH_SECRET`). */
export const TEST_LAUNCH_SECRET = process.env.LAUNCH_SECRET ?? ''

/** BL-17: the header every `/api/auth/*` request must carry — use as `.set(...launch())`. */
export function launch(): [string, string] {
  return ['X-CypherShell-Launch', TEST_LAUNCH_SECRET]
}

export function createApp(): Express {
  return createBackendApp({ rateLimit: false })
}
