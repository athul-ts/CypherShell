import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import authRoutes from './routes/auth.routes'
import profileRoutes from './routes/profile.routes'
import sessionRoutes from './routes/session.routes'
import sftpRoutes from './routes/sftp.routes'
import keyRoutes from './routes/key.routes'
import tunnelRoutes from './routes/tunnel.routes'
import auditRoutes from './routes/audit.routes'
import configRoutes from './routes/config.routes'
import { requireAuth, requireAuthFlexible } from './middleware/auth.middleware'
import { progressStream } from './controllers/sftp.controller'
import { ConfigService } from './services/config.service'
import { AuditService } from './services/audit.service'
import { logger } from './services/logger.service'

export interface CreateAppOptions {
  /**
   * Apply the SRS §10.5 rate limits. Tests turn this off so the
   * 5-attempts-per-minute unlock limit does not throttle them.
   */
  rateLimit?: boolean
}

function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
): void {
  // Allow server-to-server (no origin) — curl, health checks
  if (!origin) return callback(null, true)

  // In dev mode, the Vite dev server origin comes via env
  const allowedFromEnv = process.env.ALLOWED_CORS_ORIGINS
  if (allowedFromEnv) {
    const origins = new Set(allowedFromEnv.split(',').map((o) => o.trim().replace(/\/$/, '')))
    if (origins.has(origin) || origins.has('*')) return callback(null, true)
  }

  // Allow file:// and null (production renderer via HashRouter)
  if (origin === 'file://' || origin === 'null') return callback(null, true)

  // Allow any localhost origin (dev mode fallback)
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
    return callback(null, true)
  }

  callback(new Error('Not allowed by CORS'))
}

/**
 * Builds the Express application: middleware, routes and the error handler.
 * Does not listen and does not start background jobs, so tests exercise the
 * exact production wiring through Supertest.
 */
export function createApp({ rateLimit: withRateLimit = true }: CreateAppOptions = {}): Express {
  const app = express()

  app.use(cors({ origin: corsOrigin }))
  app.disable('x-powered-by') // SEC: don't leak framework version
  app.use(express.json())

  if (withRateLimit) {
    // Rate limiting — per SRS §10.5
    const authLimiter = rateLimit({
      windowMs: 60 * 1000,
      limit: 5,
      message: { error: 'Too many attempts. Please wait before trying again.' },
      standardHeaders: true,
      legacyHeaders: false
    })
    const apiLimiter = rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false
    })
    // Every endpoint that verifies the master password shares the 5/min budget
    app.use(['/api/auth/unlock', '/api/auth/setup-password', '/api/auth/disable-lock'], authLimiter)
    app.use('/api', apiLimiter)
  }

  // Routes
  app.use('/api/auth', authRoutes)
  app.use('/api/profiles', requireAuth, profileRoutes)
  app.use('/api/sessions', requireAuth, sessionRoutes)
  // SSE progress stream uses query-param auth because EventSource can't send headers
  app.get('/api/sftp/:sessionId/progress/:transferId', requireAuthFlexible, progressStream)
  app.use('/api/sftp', requireAuth, sftpRoutes)
  app.use('/api/keys', requireAuth, keyRoutes)
  app.use('/api/tunnels', requireAuth, tunnelRoutes)
  app.use('/api/audit', requireAuth, auditRoutes)
  app.use('/api/config', requireAuth, configRoutes)

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() })
  })

  // FUN-16: Global Express error handler — map "key not loaded" to 401
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err.message === 'Encryption key not loaded. App is locked.') {
      res.status(401).json({ error: 'App is locked. Unlock to continue.' })
    } else {
      logger.error('Unhandled error: ' + err.message)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return app
}

/**
 * Deletes audit logs older than the configured retention (FR-08.7).
 *
 * Reads the config without creating it (BL-10): before first-run setup there
 * is no config row, and creating one here would make the app report itself as
 * already configured, skipping the setup wizard.
 */
export async function purgeExpiredLogs(): Promise<void> {
  const config = await ConfigService.findConfig()
  if (config && config.logRetentionDays > 0) {
    await AuditService.clearOldLogs(config.logRetentionDays)
  }
}

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Starts the backend's background jobs: the audit-log purge runs once now and
 * then every 24 hours. Returns a function that stops them.
 */
export function startBackgroundJobs(): () => void {
  const runPurge = (): void => {
    purgeExpiredLogs().catch((err) => logger.error('Log purge failed: ' + String(err)))
  }
  runPurge()
  const purgeInterval = setInterval(runPurge, PURGE_INTERVAL_MS)
  purgeInterval.unref()
  return () => clearInterval(purgeInterval)
}
