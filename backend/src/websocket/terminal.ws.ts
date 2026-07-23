import WebSocket, { WebSocketServer } from 'ws'
import { Server } from 'http'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { SSHService } from '../services/ssh.service'
import { logger } from '../services/logger.service'

export function setupTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/ws/terminal/')) {
      // Extract token from query parameter (SEC-03)
      const urlObj = new URL(request.url, 'http://localhost')
      const token = urlObj.searchParams.get('token')

      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      try {
        jwt.verify(token, env.jwtSecret)
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
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

  wss.on('close', () => clearInterval(pingInterval))

  wss.on('connection', (ws: WebSocket, request) => {
    const sessionId = request.url?.split('/').pop()
    if (!sessionId) {
      ws.close(1008, 'Missing session ID')
      return
    }

    const session = SSHService.getSession(sessionId)
    if (!session) {
      ws.close(1008, 'Invalid session ID')
      return
    }

    ;(ws as WebSocket & { isAlive?: boolean }).isAlive = true
    ws.on('pong', () => {
      ;(ws as WebSocket & { isAlive?: boolean }).isAlive = true
    })

    session.client.shell({ term: 'xterm-256color' }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }))
        ws.close(1011, 'Failed to start shell')
        return
      }

      ws.send(JSON.stringify({ type: 'status', state: 'connected' }))

      stream.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: data.toString('base64') }))
        }
      })

      stream.on('error', (streamErr) => {
        logger.error('Shell stream error: ' + streamErr.message)
        stream.end()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'status', state: 'disconnected' }))
          ws.close(1011, 'Shell error')
        }
        SSHService.removeSession(sessionId)
      })

      stream.on('close', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'status', state: 'disconnected' }))
          ws.close(1000, 'Shell closed')
        }
        SSHService.removeSession(sessionId)
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

      ws.on('error', (wsErr) => {
        logger.error('WebSocket error: ' + wsErr.message)
        stream.end()
        SSHService.removeSession(sessionId)
      })
    })
  })
}
