import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { initDatabase } from './config/db'
import authRoutes from './routes/auth.routes'
import profileRoutes from './routes/profile.routes'
import sessionRoutes from './routes/session.routes'
import sftpRoutes from './routes/sftp.routes'
import keyRoutes from './routes/key.routes'
import tunnelRoutes from './routes/tunnel.routes'
import auditRoutes from './routes/audit.routes'
import configRoutes from './routes/config.routes'
import { requireAuth, requireAuthFlexible } from './middleware/auth.middleware'
import { ConfigService } from './services/config.service'
import { AuditService } from './services/audit.service'
import { progressStream } from './controllers/sftp.controller'
import { setupTerminalWebSocket } from './websocket/terminal.ws'
import rateLimit from 'express-rate-limit'
import { logger } from './services/logger.service'

async function bootstrap(): Promise<void> {
  await initDatabase()

  const app = express()

  app.use(
    cors({
      origin: (origin, callback) => {
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
    })
  )
  app.disable('x-powered-by') // SEC: don't leak framework version
  app.use(express.json())

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

  // Routes
  app.use('/api/auth/unlock', authLimiter)
  app.use('/api', apiLimiter)
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

  const port = Number(process.env.PORT) || 4000

  const server = app.listen(port, '127.0.0.1', () => {
    logger.info(`Backend listening on 127.0.0.1:${port}`)
  })

  setupTerminalWebSocket(server)

  const runPurge = async (): Promise<void> => {
    const config = await ConfigService.getConfig()
    if (config.logRetentionDays > 0) {
      await AuditService.clearOldLogs(config.logRetentionDays)
    }
  }
  runPurge().catch((err) => logger.error('Log purge failed: ' + err))
  const purgeInterval = setInterval(
    () => runPurge().catch((err) => logger.error('Log purge failed: ' + err)),
    24 * 60 * 60 * 1000
  )
  // CODE-15: Clear interval on server stop
  server.once('close', () => clearInterval(purgeInterval))
}

bootstrap().catch((err) => {
  logger.error('Backend bootstrap failed: ' + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
