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
import { createHash } from 'crypto'
import type { AddressInfo } from 'net'

/**
 * How the server authenticates a password login (BL-40):
 *  - password: the "password" method (default)
 *  - keyboard-interactive: only keyboard-interactive, one hidden "Password:" prompt
 *  - otp: keyboard-interactive with a password prompt and a one-time-code prompt
 *  - visible-prompt: keyboard-interactive with a single visible (echoed) prompt
 */
export type TestAuthMode = 'password' | 'keyboard-interactive' | 'otp' | 'visible-prompt'

export interface TestSshServerOptions {
  authMode?: TestAuthMode
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
  /** The server's host key as a client sees it (BL-38). */
  hostKey: { type: string; fingerprint: string; publicKey: string }
  /** Authentication requests received so far; stays 0 if the client stopped at the host key. */
  authAttempts(): number
  /** The authentication methods clients have tried, in order (BL-40). */
  authMethodsTried(): string[]
  /** Number of client connections currently open. */
  connectionCount(): number
  /** Hangs up on every connected client, like a server dropping the link (BL-32). */
  disconnectClients(): Promise<void>
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
  const parsedHostKey = parsePublicKey(hostKey)
  const blob = parsedHostKey.getPublicSSH()
  const connections = new Set<Connection>()
  let authAttempts = 0
  const methodsTried: string[] = []
  const authMode = options.authMode ?? 'password'

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    connections.add(client)
    client.on('close', () => connections.delete(client))
    client.on('error', () => {
      /* client disconnects are expected in tests */
    })

    client.on('authentication', (ctx) => {
      authAttempts++
      methodsTried.push(ctx.method)
      if (ctx.username !== username) return ctx.reject()

      if (ctx.method === 'keyboard-interactive' && authMode !== 'password') {
        const prompts =
          authMode === 'otp'
            ? [
                { prompt: 'Password: ', echo: false },
                { prompt: 'Code: ', echo: false }
              ]
            : authMode === 'visible-prompt'
              ? [{ prompt: 'Password: ', echo: true }]
              : [{ prompt: 'Password: ', echo: false }]
        return ctx.prompt(prompts, 'Login', 'Answer the prompts', (answers) => {
          const ok =
            authMode === 'keyboard-interactive' && answers.length === 1 && answers[0] === password
          return ok ? ctx.accept() : ctx.reject(['keyboard-interactive'])
        })
      }

      if (ctx.method === 'password' && authMode === 'password') {
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

      return ctx.reject(
        authMode === 'password' ? ['password', 'publickey'] : ['keyboard-interactive']
      )
    })

    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession()
        // The PTY size the client asked for, so tests can read it back with "__size__".
        let size = { cols: 80, rows: 24 }
        session.on('pty', (accept, _reject, info) => {
          size = { cols: info.cols, rows: info.rows }
          accept?.()
        })
        session.on('window-change', (accept, _reject, info) => {
          size = { cols: info.cols, rows: info.rows }
          accept?.()
        })
        session.on('shell', (accept) => {
          const stream = accept()
          stream.on('data', (data: Buffer) => {
            if (data.toString() === '__size__') stream.write(`size:${size.cols}x${size.rows}`)
            else stream.write(data)
          })
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
    hostKey: {
      type: parsedHostKey.type,
      fingerprint:
        'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, ''),
      publicKey: blob.toString('base64')
    },
    authAttempts: () => authAttempts,
    authMethodsTried: () => [...methodsTried],
    connectionCount: () => connections.size,
    authorize: (publicKey) => {
      authorized.push(parsePublicKey(publicKey))
    },
    disconnectClients: async () => {
      for (const connection of connections) connection.end()
      while (connections.size > 0) await new Promise((r) => setTimeout(r, 10))
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const connection of connections) connection.end()
        server.close(() => resolve())
      })
  }
}
