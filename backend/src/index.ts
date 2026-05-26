import express from 'express';
import cors from 'cors';
import { initDatabase } from './config/db';
import authRoutes from './routes/auth.routes';
import profileRoutes from './routes/profile.routes';
import sessionRoutes from './routes/session.routes';
import sftpRoutes from './routes/sftp.routes';
import keyRoutes from './routes/key.routes';
import tunnelRoutes from './routes/tunnel.routes';
import auditRoutes from './routes/audit.routes';
import configRoutes from './routes/config.routes';
import { requireAuth } from './middleware/auth.middleware';
import { requireAuthFlexible } from './middleware/auth.middleware';
import { progressStream } from './controllers/sftp.controller';
import { setupTerminalWebSocket } from './websocket/terminal.ws';
import rateLimit from 'express-rate-limit';

async function bootstrap() {
  await initDatabase();

  const app = express();

  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // Rate limiting — per SRS §10.5
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    message: { error: 'Too many attempts. Please wait before trying again.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Routes
  app.use('/api/auth/unlock', authLimiter);
  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/profiles', requireAuth, profileRoutes);
  app.use('/api/sessions', requireAuth, sessionRoutes);
  // SSE progress stream uses query-param auth because EventSource can't send headers
  app.get('/api/sftp/:sessionId/progress/:transferId', requireAuthFlexible, progressStream);
  app.use('/api/sftp', requireAuth, sftpRoutes);
  app.use('/api/keys', requireAuth, keyRoutes);
  app.use('/api/tunnels', requireAuth, tunnelRoutes);
  app.use('/api/audit', requireAuth, auditRoutes);
  app.use('/api/config', requireAuth, configRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  const port = Number(process.env.PORT) || 4000;

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Backend listening on 127.0.0.1:${port}`);
  });

  setupTerminalWebSocket(server);
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});
