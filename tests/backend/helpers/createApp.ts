/**
 * Builds the same Express app as backend/src/index.ts but WITHOUT calling
 * app.listen() or setting up the WebSocket server. Used by Supertest.
 *
 * Rate limits are disabled so tests aren't throttled by the 5-req/min auth
 * limiter.
 */
import express, { type Express } from 'express'
import cors from 'cors'
import authRoutes from '../../../backend/src/routes/auth.routes'
import profileRoutes from '../../../backend/src/routes/profile.routes'
import keyRoutes from '../../../backend/src/routes/key.routes'
import configRoutes from '../../../backend/src/routes/config.routes'
import auditRoutes from '../../../backend/src/routes/audit.routes'
import sftpRoutes from '../../../backend/src/routes/sftp.routes'
import tunnelRoutes from '../../../backend/src/routes/tunnel.routes'
import sessionRoutes from '../../../backend/src/routes/session.routes'
import { requireAuth, requireAuthFlexible } from '../../../backend/src/middleware/auth.middleware'
import { progressStream } from '../../../backend/src/controllers/sftp.controller'

export function createApp(): Express {
  const app = express()
  app.use(cors({ origin: '*' }))
  app.use(express.json())

  app.use('/api/auth', authRoutes)
  app.use('/api/profiles', requireAuth, profileRoutes)
  app.use('/api/sessions', requireAuth, sessionRoutes)
  app.get('/api/sftp/:sessionId/progress/:transferId', requireAuthFlexible, progressStream)
  app.use('/api/sftp', requireAuth, sftpRoutes)
  app.use('/api/keys', requireAuth, keyRoutes)
  app.use('/api/tunnels', requireAuth, tunnelRoutes)
  app.use('/api/audit', requireAuth, auditRoutes)
  app.use('/api/config', requireAuth, configRoutes)

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  return app
}
