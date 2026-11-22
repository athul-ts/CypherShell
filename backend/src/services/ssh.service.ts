import { randomUUID } from 'crypto'
import { Client, ConnectConfig } from 'ssh2'
import { Profile } from '@prisma/client'
import { CryptoService } from './crypto.service'
import { prisma } from '../config/db'
import { AuditService, type DisconnectReason } from './audit.service'
import { SftpService } from './sftp.service'
import { TunnelService } from './tunnel.service'
import { KeyService } from './key.service'
import { HostKeyError, KnownHostService } from './known-host.service'
import { logger } from './logger.service'

/** BL-40: shown when a server asks for more than the stored password. */
export const UNSUPPORTED_CHALLENGE_MESSAGE =
  'This server asked for an additional verification step (such as a one-time code), which CypherShell does not support yet.'

export interface CreateSessionOptions {
  /** Fingerprint the user confirmed for a host key that was not trusted yet (BL-38). */
  acceptHostKey?: string
}

export interface SSHSession {
  id: string
  client: Client
  profileId: string
  profileName: string
  host: string
  connectedAt: Date
  /** Why the session ended, set before it closes; absent means the remote closed it (BL-32). */
  endReason?: DisconnectReason
  endError?: string
  hasTcpListener?: boolean
  /**
   * BL-11: live users of the connection — terminal shells, running tunnels
   * and in-flight SFTP transfers. A session with consumers is never reaped.
   */
  consumers: number
  /**
   * BL-11: last heartbeat from an open Profile Detail tab or SFTP window, or
   * the last time a consumer was added or released.
   */
  lastActivityAt: number
}

export interface SessionSummary {
  id: string
  profileId: string
  profileName: string
  host: string
  connectedAt: Date
  consumers: number
}

export class SSHService {
  private static sessions = new Map<string, SSHSession>()
  /** FUN-10 / BL-11: an unused, unwatched session is closed after this long. */
  static readonly ORPHAN_TIMEOUT_MS = 60_000

  private static reaperInterval: ReturnType<typeof setInterval> | null = null

  static startReaper(): void {
    if (this.reaperInterval) return
    this.reaperInterval = setInterval(() => this.reapIdleSessions(), 15_000)
    this.reaperInterval.unref()
  }

  /**
   * Closes sessions that nothing is using: no consumers and no heartbeat
   * for `ORPHAN_TIMEOUT_MS` (BL-11). Returns the ids it closed.
   */
  static reapIdleSessions(now: number = Date.now()): string[] {
    const reaped: string[] = []
    for (const [id, session] of this.sessions) {
      if (session.consumers === 0 && now - session.lastActivityAt > this.ORPHAN_TIMEOUT_MS) {
        this.removeSession(id, 'timeout')
        reaped.push(id)
      }
    }
    return reaped
  }

  /** Registers a live user of the session. Returns false if the session is gone. */
  static acquire(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.consumers++
    session.lastActivityAt = Date.now()
    return true
  }

  /** Releases a user registered with `acquire()`. */
  static release(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.consumers = Math.max(0, session.consumers - 1)
    session.lastActivityAt = Date.now()
  }

  /** Renews the session's lease (an open tab or window is watching it). Returns false if it is gone. */
  static heartbeat(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.lastActivityAt = Date.now()
    return true
  }

  static listSessions(): SessionSummary[] {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      profileId: session.profileId,
      profileName: session.profileName,
      host: session.host,
      connectedAt: session.connectedAt,
      consumers: session.consumers
    }))
  }

  static stopReaper(): void {
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval)
      this.reaperInterval = null
    }
  }

  static async createSession(
    profile: Profile,
    options: CreateSessionOptions = {}
  ): Promise<SSHSession> {
    const client = new Client()
    const sessionId = `session-${randomUUID()}`
    // Set by the host-key verifier when it stops the handshake (BL-38).
    let hostKeyError = null as HostKeyError | null
    // Set when a keyboard-interactive challenge needs more than the stored password (BL-40).
    let unsupportedChallenge = false

    const connectConfig: ConnectConfig = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      readyTimeout: 10000, // FUN-09: timeout after 10s instead of ~20s default
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      // BL-38 / FR-11: runs during key exchange, before any credential is sent.
      hostVerifier: (key: Buffer, verify: (valid: boolean) => void): void => {
        KnownHostService.check(profile.host, profile.port, key, options.acceptHostKey)
          .then(async (result) => {
            const { keyType, fingerprint } = result.presented
            const details = {
              host: profile.host,
              port: profile.port,
              keyType,
              fingerprint,
              knownKeyType: result.known?.keyType,
              knownFingerprint: result.known?.fingerprint
            }
            if (result.outcome === 'accepted') {
              await AuditService.logHostKey(
                profile,
                'Host key trusted',
                true,
                `${keyType} ${fingerprint}`
              )
            } else if (result.outcome === 'unknown') {
              hostKeyError = new HostKeyError('HOST_KEY_UNKNOWN', details)
              await AuditService.logHostKey(
                profile,
                'Unknown host key — confirmation requested',
                true,
                `${keyType} ${fingerprint}`
              )
            } else if (result.outcome === 'mismatch') {
              hostKeyError = new HostKeyError('HOST_KEY_MISMATCH', details)
              await AuditService.logHostKey(
                profile,
                'Host key changed — connection blocked',
                false,
                `presented ${fingerprint}, trusted ${result.known?.fingerprint}`
              )
            }
            verify(result.outcome === 'trusted' || result.outcome === 'accepted')
          })
          .catch((err: unknown) => {
            logger.error('Host key check failed: ' + String(err))
            verify(false)
          })
      }
    }

    if (profile.authMethod === 'password') {
      if (!profile.encryptedPassword) throw new Error('Password required but missing')
      const plainPassword = CryptoService.decrypt(profile.encryptedPassword)
      connectConfig.password = plainPassword
      // FR-01.9 / BL-40: servers with only keyboard-interactive auth (PAM, FreeBSD).
      connectConfig.tryKeyboard = true
      client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        if (prompts.length === 0) return finish([])
        // Exactly one hidden prompt is a password prompt; anything else (a one-time
        // code, several prompts, a visible prompt) is not something to answer.
        if (prompts.length === 1 && prompts[0].echo === false) return finish([plainPassword])
        unsupportedChallenge = true
        finish([])
      })
    } else if (profile.authMethod === 'key' || profile.authMethod === 'key+passphrase') {
      if (!profile.sshKeyId) throw new Error('SSH Key required but missing')

      const sshKey = await prisma.sSHKey.findUnique({ where: { id: profile.sshKeyId } })
      if (!sshKey) throw new Error('Associated SSH Key not found')

      let passphrase: string | undefined
      if (profile.authMethod === 'key+passphrase') {
        if (!profile.encryptedPassword) throw new Error('Passphrase required but missing')
        passphrase = CryptoService.decrypt(profile.encryptedPassword)
        connectConfig.passphrase = passphrase
      }

      // BL-12: keys stored before the OpenSSH fix are converted once, here.
      connectConfig.privateKey = await KeyService.ensureUsablePrivateKey(
        sshKey.id,
        CryptoService.decrypt(sshKey.encryptedPrivateKey),
        passphrase
      )
    } else {
      throw new Error('Unsupported authentication method')
    }

    return new Promise((resolve, reject) => {
      // Only for the handshake: after `ready` an error is part of the session's end (below),
      // not a second "connection failed" entry (BL-32).
      const onConnectError = (err: Error): void => {
        // A refused host key is logged by the verifier, not as a failed connection.
        if (hostKeyError) {
          reject(hostKeyError)
          return
        }
        if (unsupportedChallenge) {
          err = new Error(UNSUPPORTED_CHALLENGE_MESSAGE)
        }
        AuditService.logConnection(
          profile.id,
          profile.name,
          profile.host,
          false,
          err.message
        ).catch(console.error)
        reject(err)
      }
      client.on('error', onConnectError)

      client.on('ready', () => {
        client.off('error', onConnectError)
        const connectedAt = new Date()
        const session: SSHSession = {
          id: sessionId,
          client,
          profileId: profile.id,
          profileName: profile.name,
          host: profile.host,
          connectedAt,
          consumers: 0,
          lastActivityAt: Date.now()
        }
        this.sessions.set(sessionId, session)
        this.startReaper()
        AuditService.logConnection(profile.id, profile.name, profile.host, true).catch(
          console.error
        )

        // An error after `ready` (keepalive timeout, reset, …) ends the session; `close`
        // follows and writes the single disconnect entry.
        client.on('error', (postConnectErr) => {
          session.endReason ??= 'error'
          session.endError ??= postConnectErr.message
        })

        client.on('close', () => {
          const durationMs = Date.now() - connectedAt.getTime()
          AuditService.logDisconnect(
            profile.id,
            profile.name,
            profile.host,
            session.endReason ?? 'closed',
            durationMs,
            session.endError
          ).catch(console.error)
          this.sessions.delete(sessionId)
        })

        resolve(session)
      })

      client.connect(connectConfig)
    })
  }

  static getSession(sessionId: string): SSHSession | undefined {
    return this.sessions.get(sessionId)
  }

  /** Closes a session. `reason` is recorded in its disconnect log entry (FR-08.2). */
  static removeSession(sessionId: string, reason: DisconnectReason = 'user'): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.endReason ??= reason
      session.client.end()
      this.sessions.delete(sessionId)
    }
    // Clean up cached SFTP client (FUN-03) and tunnel servers (FUN-05)
    SftpService.closeSession(sessionId).catch(() => {})
    TunnelService.cleanupSession(sessionId)
  }
}
