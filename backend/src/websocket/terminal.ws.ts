import WebSocket, { WebSocketServer } from 'ws'
import type { ClientChannel } from 'ssh2'
import type { Server } from 'http'
import type { Duplex } from 'stream'
import { verifyToken } from '../middleware/auth.middleware'
import {
  callerPolicyFromEnv,
  upgradeRefusal,
  type CallerPolicy
} from '../middleware/caller.middleware'
import { SSHService } from '../services/ssh.service'
import { AppLockService } from '../services/app-lock.service'
import { logger } from '../services/logger.service'

/** Close code sent to every terminal when the app locks (BL-18). The renderer does not reconnect. */
export const APP_LOCKED_CLOSE_CODE = 4001

/** Close code sent when the SSH connection was lost and could not be restored (BL-41). */
export const SSH_LOST_CLOSE_CODE = 4002

export interface TerminalWebSocketOptions {
  /** BL-17: who may open a terminal. Defaults to `LAUNCH_SECRET` / `ALLOWED_CORS_ORIGINS`. */
  callerPolicy?: CallerPolicy
}

/** Answers a refused upgrade with a plain HTTP status and drops the socket. */
function refuse(socket: Duplex, status: '401 Unauthorized' | '403 Forbidden'): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export function setupTerminalWebSocket(
  server: Server,
  { callerPolicy = callerPolicyFromEnv() }: TerminalWebSocketOptions = {}
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/ws/terminal/')) {
      socket.destroy()
      return
    }
    const urlObj = new URL(request.url, 'http://localhost')

    // BL-17: the same Host / Origin rules as REST, plus the launch secret.
    const refusal = upgradeRefusal(callerPolicy, request, urlObj)
    if (refusal) {
      logger.warn(`Refused terminal WebSocket: ${refusal}`)
      refuse(socket, '403 Forbidden')
      return
    }

    // Token from the query parameter (SEC-03). BL-18: the full check REST and
    // SSE use — signature, expiry and a jti that a lock has not revoked.
    const token = urlObj.searchParams.get('token')
    try {
      if (!token) throw new Error('Missing token')
      verifyToken(token)
    } catch {
      refuse(socket, '401 Unauthorized')
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  // CODE-06: Server-side ping interval — detects half-open sockets
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as WebSocket & { isAlive?: boolean }).isAlive === false) {
        ws.terminate()
        return
      }
      ;(ws as WebSocket & { isAlive?: boolean }).isAlive = false
      ws.ping()
    })
  }, 30_000)
  pingInterval.unref()

  wss.on('close', () => clearInterval(pingInterval))

  wss.on('connection', (ws: WebSocket, request) => {
    const sessionId = request.url?.split('?')[0].split('/').pop()
    if (!sessionId) {
      ws.close(1008, 'Missing session ID')
      return
    }

    const session = SSHService.getSession(sessionId)
    if (!session || !SSHService.acquire(sessionId)) {
      ws.close(1008, 'Invalid session ID')
      return
    }

    // BL-11: this terminal keeps the SSH session alive until its socket closes.
    // Closing one terminal releases only its shell — never the whole session.
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      SSHService.release(sessionId)
    }
    ws.on('close', release)
    ;(ws as WebSocket & { isAlive?: boolean }).isAlive = true
    ws.on('pong', () => {
      ;(ws as WebSocket & { isAlive?: boolean }).isAlive = true
    })

    // BL-18: a lock ends this terminal's shell at once and closes the socket.
    let endShell: (() => void) | null = null
    const stopListeningForLock = AppLockService.onLock(() => {
      endShell?.()
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(APP_LOCKED_CLOSE_CODE, 'App locked')
      }
    })
    ws.on('close', stopListeningForLock)

    // BL-29: messages that arrive before the remote shell is ready are kept, not
    // dropped — the renderer sends its first resize the moment the socket opens.
    let stream: ClientChannel | null = null
    let size: { cols: number; rows: number } | null = null
    const pendingInput: Buffer[] = []
    let hadShell = false

    const send = (data: object): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'input' && msg.data) {
          const bytes = Buffer.from(msg.data, 'base64')
          if (stream) stream.write(bytes)
          // BL-41: input typed while the connection is down is dropped, not replayed on a new shell.
          else if (session.state === 'connected') pendingInput.push(bytes)
        } else if (msg.type === 'resize' && msg.cols && msg.rows) {
          size = { cols: msg.cols, rows: msg.rows }
          if (stream) stream.setWindow(msg.rows, msg.cols, 0, 0)
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
      } catch (e) {
        logger.error('WebSocket message error: ' + (e instanceof Error ? e.message : String(e)))
      }
    })

    /** Opens a shell on the session's current client — again after a reconnect (BL-41). */
    const openShell = (): void => {
      session.client.shell({ term: 'xterm-256color' }, (err, channel) => {
        if (err) {
          if (ws.readyState === WebSocket.OPEN) {
            send({ type: 'error', message: err.message })
            ws.close(1011, 'Failed to start shell')
          }
          return
        }

        if (ws.readyState !== WebSocket.OPEN) {
          channel.end() // the terminal window closed (or the app locked) while the shell was starting
          return
        }
        const reopened = hadShell
        hadShell = true
        stream = channel
        endShell = () => channel.end()
        if (size) channel.setWindow(size.rows, size.cols, 0, 0)
        for (const bytes of pendingInput.splice(0)) channel.write(bytes)

        if (reopened) {
          const note = '\r\n[Connection lost — reconnected]\r\n'
          send({ type: 'output', data: Buffer.from(note).toString('base64') })
        }
        send({ type: 'status', state: 'connected' })

        channel.on('data', (data: Buffer) => {
          send({ type: 'output', data: data.toString('base64') })
        })

        channel.on('error', (streamErr: Error) => {
          logger.error('Shell stream error: ' + streamErr.message)
          channel.end()
          if (ws.readyState === WebSocket.OPEN) {
            send({ type: 'status', state: 'disconnected' })
            ws.close(1011, 'Shell error')
          }
        })

        channel.on('close', () => {
          if (stream !== channel) return
          stream = null
          // ssh2 closes the client before its channels: wait for the decision to reconnect.
          void Promise.resolve(session.closing).then(() => {
            if (ws.readyState !== WebSocket.OPEN) return
            if (session.state === 'reconnecting' || session.lost) return // the session events handle it
            send({ type: 'status', state: 'disconnected' })
            ws.close(1000, 'Shell closed')
          })
        })
      })
    }

    // BL-41: follow the session through a reconnect.
    const onReconnecting = (): void => send({ type: 'status', state: 'reconnecting' })
    const onReconnected = (): void => openShell()
    const onLost = (): void => {
      send({ type: 'status', state: 'disconnected' })
      if (ws.readyState === WebSocket.OPEN) ws.close(SSH_LOST_CLOSE_CODE, 'SSH connection lost')
    }
    const onClosed = (): void => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Session closed')
    }
    session.events.on('reconnecting', onReconnecting)
    session.events.on('reconnected', onReconnected)
    session.events.on('lost', onLost)
    session.events.on('closed', onClosed)
    ws.on('close', () => {
      session.events.off('reconnecting', onReconnecting)
      session.events.off('reconnected', onReconnected)
      session.events.off('lost', onLost)
      session.events.off('closed', onClosed)
      stream?.end()
    })

    if (session.state === 'reconnecting') onReconnecting()
    else openShell()

    ws.on('error', (wsErr) => {
      logger.error('WebSocket error: ' + wsErr.message)
      release()
    })
  })

  return wss
}
