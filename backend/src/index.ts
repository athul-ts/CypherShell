import { initDatabase } from './config/db'
import { createApp, startBackgroundJobs } from './app'
import { setupTerminalWebSocket } from './websocket/terminal.ws'
import { AppLockService } from './services/app-lock.service'
import { HostBridge } from './services/host-bridge.service'
import { logger } from './services/logger.service'
import { Secrets } from './config/secrets'

async function bootstrap(): Promise<void> {
  // BL-46: inside the Electron utility process the secrets arrive in the first message from main,
  // before anything that needs them is created. Otherwise they come from the environment.
  const init = await HostBridge.receiveInit()
  if (init) {
    Secrets.set(init)
    logger.info('Start-up secrets received from the main process')
  }

  await initDatabase()

  const app = createApp()
  const port = Number(process.env.PORT) || 4000

  const server = app.listen(port, '127.0.0.1', () => {
    logger.info(`Backend listening on 127.0.0.1:${port}`)
  })

  setupTerminalWebSocket(server)

  // BL-18: the main process owns the idle clock. It learns the auto-lock
  // policy and every lock from here, and asks for a lock over the IPC channel.
  AppLockService.onLock(() => HostBridge.send({ type: 'locked' }))
  AppLockService.onPolicy((policy) => HostBridge.send({ type: 'lock-policy', ...policy }))
  HostBridge.onMessage((message) => {
    if (message.type === 'lock') AppLockService.lock()
  })
  await AppLockService.publishPolicy()

  // CODE-15: stop the background jobs when the server stops
  const stopBackgroundJobs = startBackgroundJobs()
  server.once('close', stopBackgroundJobs)
}

// BL-18: if the main process goes away, do not linger holding the encryption
// key and live SSH sessions — exit with it.
HostBridge.onDisconnect(() => {
  logger.warn('Main process disconnected; exiting.')
  process.exit(0)
})

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
