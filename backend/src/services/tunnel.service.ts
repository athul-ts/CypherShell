import { SSHService } from './ssh.service'
import net from 'net'
import type { Duplex } from 'stream'
import { logger } from './logger.service'

/**
 * Pipes a local TCP socket and an SSH channel both ways. Every stream gets an
 * `error` listener: without one, a client that resets its connection raises
 * an unhandled error that takes down the whole backend (BL-16). An error on
 * either side closes both.
 */
function bridge(socket: net.Socket, channel: Duplex): void {
  const teardown = (): void => {
    socket.destroy()
    channel.destroy()
  }
  socket.on('error', teardown)
  channel.on('error', teardown)
  socket.pipe(channel)
  channel.pipe(socket)
}

export class TunnelService {
  private static localServers = new Map<string, net.Server>()

  static async checkPort(port: number, host: string = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close()
        resolve(true)
      })
      server.listen(port, host)
    })
  }

  /** Starts listening and, once bound, registers the tunnel as a session consumer (BL-11). */
  private static listen(
    server: net.Server,
    id: string,
    sessionId: string,
    localPort: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(localPort, '127.0.0.1', () => {
        server.off('error', reject)
        server.on('error', (err) => logger.error(`Tunnel ${id} error: ${err.message}`))
        this.localServers.set(id, server)
        SSHService.acquire(sessionId)
        resolve()
      })
    })
  }

  private static stopLocalServer(id: string, sessionId: string): void {
    const server = this.localServers.get(id)
    if (!server) return
    server.close()
    this.localServers.delete(id)
    SSHService.release(sessionId)
  }

  static async startLocalForward(
    sessionId: string,
    localPort: number,
    remoteHost: string,
    remotePort: number
  ): Promise<void> {
    const session = SSHService.getSession(sessionId)
    if (!session) throw new Error('Session not found')

    const isFree = await this.checkPort(localPort)
    if (!isFree) throw new Error(`Port ${localPort} is already in use`)

    const server = net.createServer((socket) => {
      // Attach before the channel opens: the client may reset while we wait.
      socket.on('error', () => socket.destroy())
      session.client.forwardOut('127.0.0.1', localPort, remoteHost, remotePort, (err, stream) => {
        if (err) {
          socket.destroy()
          return
        }
        if (socket.destroyed) {
          stream.destroy()
          return
        }
        bridge(socket, stream)
      })
    })

    await this.listen(server, `local-${sessionId}-${localPort}`, sessionId, localPort)
  }

  static async stopLocalForward(sessionId: string, localPort: number): Promise<void> {
    this.stopLocalServer(`local-${sessionId}-${localPort}`, sessionId)
  }

  // CODE-05: Per-session map of remotePort → forward target, used by a
  // single shared tcp connection dispatcher instead of a hardcoded 1-to-1.
  private static remoteForwards = new Map<
    string,
    Map<number, { localHost: string; localPort: number }>
  >()

  static async startRemoteForward(
    sessionId: string,
    remotePort: number,
    localHost: string,
    localPort: number
  ): Promise<void> {
    const session = SSHService.getSession(sessionId)
    if (!session) throw new Error('Session not found')

    // Add this forward to the map before registering on the SSH client
    let sessionForwards = this.remoteForwards.get(sessionId)
    if (!sessionForwards) {
      sessionForwards = new Map()
      this.remoteForwards.set(sessionId, sessionForwards)
    }
    sessionForwards.set(remotePort, { localHost, localPort })

    return new Promise<void>((resolve, reject) => {
      session.client.forwardIn('127.0.0.1', remotePort, (err) => {
        if (err) {
          // Roll back the map entry on failure
          sessionForwards!.delete(remotePort)
          return reject(err)
        }

        // Register a single shared tcp connection dispatcher (lazy, once)
        if (!session.hasTcpListener) {
          session.client.on('tcp connection', (details, acceptConnection, rejectConnection) => {
            const fwd = sessionForwards?.get(details.destPort)
            if (!fwd) {
              rejectConnection()
              return
            }
            let accepted = false
            const socket = net.connect(fwd.localPort, fwd.localHost, () => {
              accepted = true
              bridge(socket, acceptConnection())
            })
            // Before the bridge exists, a refused local port rejects the channel.
            socket.on('error', () => {
              if (!accepted) rejectConnection()
            })
          })
          session.hasTcpListener = true
        }

        SSHService.acquire(sessionId)
        resolve()
      })
    })
  }

  static async stopRemoteForward(sessionId: string, remotePort: number): Promise<void> {
    const sessionForwards = this.remoteForwards.get(sessionId)
    const existed = sessionForwards?.delete(remotePort) ?? false
    if (sessionForwards && sessionForwards.size === 0) this.remoteForwards.delete(sessionId)
    const session = SSHService.getSession(sessionId)
    if (!session) return
    session.client.unforwardIn('127.0.0.1', remotePort, () => {})
    if (existed) SSHService.release(sessionId)
  }

  static async startDynamicForward(sessionId: string, localPort: number): Promise<void> {
    const session = SSHService.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    // Captured after the null check so the nested SOCKS parser keeps the narrowed type.
    const sshClient = session.client

    const isFree = await this.checkPort(localPort)
    if (!isFree) throw new Error(`Port ${localPort} is already in use`)

    const server = net.createServer((socket) => {
      // CODE-04: Buffer incoming bytes and parse incrementally so we handle
      // TCP fragmentation correctly instead of assuming one chunk per message.
      let buf = Buffer.alloc(0)
      let state: 'GREETING' | 'REQUEST' | 'CONNECTING' | 'CONNECTED' = 'GREETING'

      function tryParse(): void {
        if (state === 'GREETING') {
          if (buf.length < 3) return
          if (buf[0] !== 0x05) {
            socket.end()
            return
          }
          const nmethods = buf[1]
          const total = 2 + nmethods
          if (buf.length < total) return
          buf = buf.subarray(total)
          socket.write(Buffer.from([0x05, 0x00])) // NO AUTH
          state = 'REQUEST'
          tryParse() // data may already contain the request
        } else if (state === 'REQUEST') {
          if (buf.length < 5) return
          if (buf[0] !== 0x05 || buf[1] !== 0x01) {
            socket.end()
            return
          }
          const atyp = buf[3]
          let headerLen: number
          if (atyp === 0x01) {
            headerLen = 10 // ver+cmd+rsv+atyp(4) + IPv4(4) + port(2)
          } else if (atyp === 0x03) {
            headerLen = 5 + buf[4] + 2 // ver+cmd+rsv+atyp + nameLen + name + port
          } else {
            socket.end()
            return
          }
          if (buf.length < headerLen) return

          let hostStr: string
          let port: number
          if (atyp === 0x01) {
            hostStr = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`
            port = buf.readUInt16BE(8)
          } else {
            const len = buf[4]
            hostStr = buf.toString('utf8', 5, 5 + len)
            port = buf.readUInt16BE(5 + len)
          }
          buf = buf.subarray(headerLen)
          state = 'CONNECTING' // stop parsing; buffer anything sent early

          sshClient.forwardOut('127.0.0.1', localPort, hostStr, port, (err, stream) => {
            if (err) {
              socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
              return socket.end()
            }
            if (socket.destroyed) {
              stream.destroy()
              return
            }
            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
            state = 'CONNECTED'
            socket.off('data', onData)
            if (buf.length > 0) stream.write(buf)
            buf = Buffer.alloc(0)
            bridge(socket, stream)
          })
        }
      }

      const onData = (chunk: Buffer): void => {
        buf = Buffer.concat([buf, chunk])
        tryParse()
      }
      socket.on('data', onData)
      socket.on('error', () => socket.destroy())
    })

    await this.listen(server, `dynamic-${sessionId}-${localPort}`, sessionId, localPort)
  }

  static async stopDynamicForward(sessionId: string, localPort: number): Promise<void> {
    this.stopLocalServer(`dynamic-${sessionId}-${localPort}`, sessionId)
  }

  /** FUN-05: Clean up all tunnel servers for a given session. */
  static cleanupSession(sessionId: string): void {
    for (const [id, server] of this.localServers) {
      if (id.includes(`-${sessionId}-`)) {
        try {
          server.close()
        } catch {
          /* ignore */
        }
        this.localServers.delete(id)
      }
    }
    this.remoteForwards.delete(sessionId)
  }
}
