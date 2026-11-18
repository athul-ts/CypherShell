import WebSocket, { WebSocketServer } from 'ws'
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

    session.client.shell({ term: 'xterm-256color' }, (err, stream) => {
      if (err) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }))
          ws.close(1011, 'Failed to start shell')
        }
        return
      }

      if (ws.readyState !== WebSocket.OPEN) {
        stream.end() // the terminal window closed (or the app locked) while the shell was starting
        return
      }
      endShell = () => stream.end()

      ws.send(JSON.stringify({ type: 'status', state: 'connected' }))

      stream.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: data.toString('base64') }))
        }
      })

      stream.on('error', (streamErr: Error) => {
        logger.error('Shell stream error: ' + streamErr.message)
        stream.end()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'status', state: 'disconnected' }))
          ws.close(1011, 'Shell error')
        }
      })

      stream.on('close', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'status', state: 'disconnected' }))
          ws.close(1000, 'Shell closed')
        }
      })

      ws.on('message', (message) => {
        try {
          const msg = JSON.parse(message.toString())
          if (msg.type === 'input' && msg.data) {
            stream.write(Buffer.from(msg.data, 'base64'))
          } else if (msg.type === 'resize' && msg.cols && msg.rows) {
            stream.setWindow(msg.rows, msg.cols, 0, 0)
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }))
          }
        } catch (e) {
          logger.error('WebSocket message error: ' + (e instanceof Error ? e.message : String(e)))
        }
      })

      ws.on('close', () => {
        stream.end()
      })
    })

    ws.on('error', (wsErr) => {
      logger.error('WebSocket error: ' + wsErr.message)
      release()
    })
  })

  return wss
}
