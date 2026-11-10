/**
 * The real backend app (backend/src/app.ts) with rate limits disabled, so
 * tests exercise production routing, CORS and the error handler without the
 * 5-attempts-per-minute unlock limit throttling them. No listen(), no
 * WebSocket server and no background jobs — tests start those explicitly.
 */
import type { Express } from 'express'
import { createApp as createBackendApp } from '../../../backend/src/app'

export function createApp(): Express {
  return createBackendApp({ rateLimit: false })
}
