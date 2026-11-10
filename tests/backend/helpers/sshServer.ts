/**
 * In-process SSH server for backend integration tests, built on ssh2's own
 * `Server`. It lets tests drive the real SSH code paths (connect, key auth,
 * shells, port forwards) without Docker or a system sshd.
 *
 * Supports:
 *  - password auth and public-key auth (signature verified)
 *  - pty + shell sessions that echo every byte back
 *  - direct-tcpip channels (the server side of `forwardOut`) that echo
 */
import { Server, utils, type Connection, type ParsedKey } from 'ssh2'
import type { AddressInfo } from 'net'

export interface TestSshServerOptions {
  username?: string
  password?: string
  /** OpenSSH-format public keys accepted for public-key auth. */
  authorizedKeys?: string[]
}

export interface TestSshServer {
  host: string
  port: number
  username: string
  password: string
  /** Number of client connections currently open. */
  connectionCount(): number
  /** Accepts another OpenSSH-format public key for public-key auth. */
  authorize(publicKey: string): void
  close(): Promise<void>
}

export async function startTestSshServer(
  options: TestSshServerOptions = {}
): Promise<TestSshServer> {
  const username = options.username ?? 'tester'
  const password = options.password ?? 'secret-pass'
  const parsePublicKey = (pub: string): ParsedKey => {
    const parsed = utils.parseKey(pub)
    if (parsed instanceof Error) throw parsed
    return Array.isArray(parsed) ? parsed[0] : parsed
  }
  const authorized: ParsedKey[] = (options.authorizedKeys ?? []).map(parsePublicKey)

  const hostKey = utils.generateKeyPairSync('ed25519').private
  const connections = new Set<Connection>()

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    connections.add(client)
    client.on('close', () => connections.delete(client))
    client.on('error', () => {
      /* client disconnects are expected in tests */
    })

    client.on('authentication', (ctx) => {
      if (ctx.username !== username) return ctx.reject()

      if (ctx.method === 'password') {
        return ctx.password === password ? ctx.accept() : ctx.reject()
      }

      if (ctx.method === 'publickey') {
        const match = authorized.find(
          (key) => key.type === ctx.key.algo && key.getPublicSSH().equals(ctx.key.data)
        )
        if (!match) return ctx.reject()
        // Without a signature the client is only asking whether the key is acceptable.
        if (!ctx.signature || !ctx.blob) return ctx.accept()
        return match.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true
          ? ctx.accept()
          : ctx.reject()
      }

      return ctx.reject(['password', 'publickey'])
    })

    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession()
        session.on('pty', (accept) => accept?.())
        session.on('window-change', (accept) => accept?.())
        session.on('shell', (accept) => {
          const stream = accept()
          stream.on('data', (data: Buffer) => stream.write(data))
          stream.on('error', () => {})
        })
      })

      client.on('tcpip', (accept) => {
        const channel = accept()
        channel.on('data', (data: Buffer) => channel.write(data))
        channel.on('error', () => {})
      })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo

  return {
    host: '127.0.0.1',
    port,
    username,
    password,
    connectionCount: () => connections.size,
    authorize: (publicKey) => {
      authorized.push(parsePublicKey(publicKey))
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const connection of connections) connection.end()
        server.close(() => resolve())
      })
  }
}
