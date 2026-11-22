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
import { Server, utils, type Connection, type ParsedKey, type SFTPWrapper } from 'ssh2'
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
  /**
   * Serves an SFTP subsystem whose every directory holds this many entries (BL-45):
   * every tenth is a directory. Supports REALPATH, OPENDIR, READDIR, STAT, LSTAT and CLOSE;
   * anything else answers OP_UNSUPPORTED. Without it the server has no SFTP subsystem.
   */
  sftpEntries?: number
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

const SFTP_BATCH = 100

/** An in-memory directory: `count` entries, every tenth a directory. */
function serveSftp(sftp: SFTPWrapper, count: number): void {
  const { STATUS_CODE } = utils.sftp
  const mtime = Math.floor(Date.now() / 1000)
  const entries = Array.from({ length: count }, (_, i) => {
    const dir = i % 10 === 0
    const filename = `${dir ? 'dir' : 'file'}-${String(i).padStart(5, '0')}`
    const mode = dir ? 0o40755 : 0o100644
    return {
      filename,
      longname: `${dir ? 'drwxr-xr-x' : '-rw-r--r--'} 1 tester tester ${i} Jan  1 00:00 ${filename}`,
      attrs: { mode, uid: 1000, gid: 1000, size: i, atime: mtime, mtime }
    }
  })
  const handles = new Map<string, { sent: number }>()
  let nextHandle = 0
  const dirAttrs = { mode: 0o40755, uid: 1000, gid: 1000, size: 0, atime: mtime, mtime }

  sftp.on('REALPATH', (reqid, path) => {
    const resolved = path === '.' || path === '' ? '/home/tester' : path
    sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: dirAttrs }])
  })
  sftp.on('OPENDIR', (reqid) => {
    const id = Buffer.from(String(nextHandle++))
    handles.set(id.toString(), { sent: 0 })
    sftp.handle(reqid, id)
  })
  sftp.on('READDIR', (reqid, handle) => {
    const state = handles.get(handle.toString())
    if (!state) return sftp.status(reqid, STATUS_CODE.FAILURE)
    if (state.sent >= entries.length) return sftp.status(reqid, STATUS_CODE.EOF)
    const batch = entries.slice(state.sent, state.sent + SFTP_BATCH)
    state.sent += batch.length
    sftp.name(reqid, batch)
  })
  sftp.on('CLOSE', (reqid, handle) => {
    handles.delete(handle.toString())
    sftp.status(reqid, STATUS_CODE.OK)
  })
  const stat = (reqid: number): void => sftp.attrs(reqid, dirAttrs)
  sftp.on('STAT', stat)
  sftp.on('LSTAT', stat)
  // Everything else is not supported by this fixture.
  for (const op of [
    'OPEN',
    'READ',
    'WRITE',
    'REMOVE',
    'RMDIR',
    'MKDIR',
    'RENAME',
    'SETSTAT'
  ] as const) {
    sftp.on(op, (reqid: number) => sftp.status(reqid, STATUS_CODE.OP_UNSUPPORTED))
  }
  sftp.on('error', () => {})
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

  // ssh2 writes about 1 in 300 ed25519 keys that it cannot parse itself: make another.
  let hostKey = utils.generateKeyPairSync('ed25519').private
  while (utils.parseKey(hostKey) instanceof Error) {
    hostKey = utils.generateKeyPairSync('ed25519').private
  }
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
        const sftpEntries = options.sftpEntries
        if (sftpEntries !== undefined) {
          session.on('sftp', (acceptSftp) => serveSftp(acceptSftp(), sftpEntries))
        }
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
