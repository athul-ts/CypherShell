import { SSHService } from './ssh.service'
import net from 'net'

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
      session.client.forwardOut('127.0.0.1', localPort, remoteHost, remotePort, (err, stream) => {
        if (err) {
          socket.end()
          return
        }
        socket.pipe(stream)
        stream.pipe(socket)
      })
    })

    return new Promise<void>((resolve, reject) => {
      server.listen(localPort, '127.0.0.1', () => {
        const id = `local-${sessionId}-${localPort}`
        this.localServers.set(id, server)
        resolve()
      })
      server.on('error', reject)
    })
  }

  static async stopLocalForward(sessionId: string, localPort: number): Promise<void> {
    const id = `local-${sessionId}-${localPort}`
    const server = this.localServers.get(id)
    if (server) {
      server.close()
      this.localServers.delete(id)
    }
  }

  // CODE-05: Per-session map of remotePort → forward target, used by a
  // single shared tcp connection dispatcher instead of a hardcoded 1-to-1.
  private static remoteForwards = new Map<string, Map<number, { localHost: string; localPort: number }>>()

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
            if (!fwd) { rejectConnection(); return }
            const socket = net.connect(fwd.localPort, fwd.localHost, () => {
              const stream = acceptConnection()
              socket.pipe(stream)
              stream.pipe(socket)
            })
            socket.on('error', () => rejectConnection())
          })
          session.hasTcpListener = true
        }

        resolve()
      })
    })
  }

  static async stopRemoteForward(sessionId: string, remotePort: number): Promise<void> {
    const sessionForwards = this.remoteForwards.get(sessionId)
    if (sessionForwards) {
      sessionForwards.delete(remotePort)
      if (sessionForwards.size === 0) this.remoteForwards.delete(sessionId)
    }
    const session = SSHService.getSession(sessionId)
    if (!session) return
    session.client.unforwardIn('127.0.0.1', remotePort, () => {})
  }

  static async startDynamicForward(sessionId: string, localPort: number): Promise<void> {
    const session = SSHService.getSession(sessionId)
    if (!session) throw new Error('Session not found')

    const isFree = await this.checkPort(localPort)
    if (!isFree) throw new Error(`Port ${localPort} is already in use`)

    const server = net.createServer((socket) => {
      // CODE-04: Buffer incoming bytes and parse incrementally so we handle
      // TCP fragmentation correctly instead of assuming one chunk per message.
      let buf = Buffer.alloc(0)
      let state: 'GREETING' | 'REQUEST' | 'CONNECTED' = 'GREETING'

      function tryParse(): void {
        if (state === 'GREETING') {
          if (buf.length < 3) return
          if (buf[0] !== 0x05) { socket.end(); return }
          const nmethods = buf[1]
          const total = 2 + nmethods
          if (buf.length < total) return
          buf = buf.subarray(total)
          socket.write(Buffer.from([0x05, 0x00])) // NO AUTH
          state = 'REQUEST'
          tryParse() // data may already contain the request
        } else if (state === 'REQUEST') {
          if (buf.length < 5) return
          if (buf[0] !== 0x05 || buf[1] !== 0x01) { socket.end(); return }
          const atyp = buf[3]
          let headerLen: number
          if (atyp === 0x01) {
            headerLen = 10 // ver+cmd+rsv+atyp(4) + IPv4(4) + port(2)
          } else if (atyp === 0x03) {
            headerLen = 5 + buf[4] + 2 // ver+cmd+rsv+atyp + nameLen + name + port
          } else {
            socket.end(); return
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

          session.client.forwardOut('127.0.0.1', localPort, hostStr, port, (err, stream) => {
            if (err) {
              socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
              return socket.end()
            }
            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
            socket.pipe(stream)
            stream.pipe(socket)
            state = 'CONNECTED'
          })
        }
      }

      socket.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk])
        tryParse()
      })
      socket.on('error', () => {})
    })

    return new Promise<void>((resolve, reject) => {
      server.listen(localPort, '127.0.0.1', () => {
        const id = `dynamic-${sessionId}-${localPort}`
        this.localServers.set(id, server)
        resolve()
      })
      server.on('error', reject)
    })
  }

  static async stopDynamicForward(sessionId: string, localPort: number): Promise<void> {
    const id = `dynamic-${sessionId}-${localPort}`
    const server = this.localServers.get(id)
    if (server) {
      server.close()
      this.localServers.delete(id)
    }
  }

  /** FUN-05: Clean up all tunnel servers for a given session. */
  static cleanupSession(sessionId: string): void {
    for (const [id, server] of this.localServers) {
      if (id.includes(`-${sessionId}-`)) {
        try { server.close() } catch { /* ignore */ }
        this.localServers.delete(id)
      }
    }
  }
}
