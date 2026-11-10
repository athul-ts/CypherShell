import { initDatabase } from './config/db'
import { createApp, startBackgroundJobs } from './app'
import { setupTerminalWebSocket } from './websocket/terminal.ws'
import { logger } from './services/logger.service'

async function bootstrap(): Promise<void> {
  await initDatabase()

  const app = createApp()
  const port = Number(process.env.PORT) || 4000

  const server = app.listen(port, '127.0.0.1', () => {
    logger.info(`Backend listening on 127.0.0.1:${port}`)
  })

  setupTerminalWebSocket(server)

  // CODE-15: stop the background jobs when the server stops
  const stopBackgroundJobs = startBackgroundJobs()
  server.once('close', stopBackgroundJobs)
}

// BL-16: a stray rejected promise must not take down every SSH session.
// (Node's default since v15 is to crash.) Genuine crashes still exit, and
// the Electron main process restarts the backend.
process.on('unhandledRejection', (reason) => {
  logger.error(
    'Unhandled promise rejection: ' +
      (reason instanceof Error ? (reason.stack ?? reason.message) : String(reason))
  )
})

bootstrap().catch((err) => {
  logger.error('Backend bootstrap failed: ' + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
