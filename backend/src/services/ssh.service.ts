import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
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
import { AppLockService } from './app-lock.service'

/** BL-40: shown when a server asks for more than the stored password. */
export const UNSUPPORTED_CHALLENGE_MESSAGE =
  'This server asked for an additional verification step (such as a one-time code), which CypherShell does not support yet.'

export interface CreateSessionOptions {
  /** Fingerprint the user confirmed for a host key that was not trusted yet (BL-38). */
  acceptHostKey?: string
}

/**
 * BL-41: `reconnecting` while the backend re-creates a dropped connection. Events on
 * `session.events`: `reconnecting`, `reconnected`, `lost` (given up) and `closed`
 * (removed while reconnecting).
 */
export type SessionState = 'connected' | 'reconnecting'

export interface SSHSession {
  id: string
  client: Client
  state: SessionState
  events: EventEmitter
  /** When the current client connected, for the duration in its disconnect entry. */
  clientStartedAt: number
  /** Set by `removeSession`: nothing reconnects a removed session. */
  removed?: boolean
  /** Set when a reconnect was given up; terminals close with 4002 (BL-41). */
  lost?: boolean
  /** Settles once the decision after the client closed (reconnect or give up) has been made. */
  closing?: Promise<void>
  cancelReconnect?: (reason: 'removed' | 'locked') => void
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

  /**
   * Opens and authenticates one SSH connection: the host key is verified first (BL-38),
   * then the credentials are sent. Shared by `createSession` and reconnects (BL-41).
   * It does not register a session. `auditFailure` writes the "Connection failed" entry.
   */
  private static async connectClient(
    profile: Profile,
    options: CreateSessionOptions,
    auditFailure: boolean
  ): Promise<Client> {
    const client = new Client()
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
      // Only for the handshake: after `ready` an error is part of the session's end,
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
        if (auditFailure) {
          AuditService.logConnection(
            profile.id,
            profile.name,
            profile.host,
            false,
            err.message
          ).catch(console.error)
        }
        reject(err)
      }
      client.on('error', onConnectError)

      client.on('ready', () => {
        client.off('error', onConnectError)
        resolve(client)
      })

      client.connect(connectConfig)
    })
  }

  static async createSession(
    profile: Profile,
    options: CreateSessionOptions = {}
  ): Promise<SSHSession> {
    const client = await this.connectClient(profile, options, true)
    const session: SSHSession = {
      id: `session-${randomUUID()}`,
      client,
      state: 'connected',
      events: new EventEmitter().setMaxListeners(0),
      clientStartedAt: Date.now(),
      profileId: profile.id,
      profileName: profile.name,
      host: profile.host,
      connectedAt: new Date(),
      consumers: 0,
      lastActivityAt: Date.now()
    }
    this.sessions.set(session.id, session)
    this.startReaper()
    AuditService.logConnection(profile.id, profile.name, profile.host, true).catch(console.error)
    this.attachClient(session, client)
    return session
  }

  /**
   * Wires a connected client to its session. An error after `ready` (keepalive timeout,
   * reset, …) ends the connection; `close` follows and writes the single disconnect entry.
   */
  private static attachClient(session: SSHSession, client: Client): void {
    client.on('error', (err) => {
      if (session.client !== client) return
      session.endReason ??= 'error'
      session.endError ??= err.message
    })
    client.on('close', () => this.onClientClosed(session, client))
  }

  private static onClientClosed(session: SSHSession, client: Client): void {
    if (session.client !== client) return // a client that was already replaced
    const reason = session.endReason ?? 'closed'
    AuditService.logDisconnect(
      session.profileId,
      session.profileName,
      session.host,
      reason,
      Date.now() - session.clientStartedAt,
      session.endError
    ).catch(console.error)

    if (session.removed || reason === 'user' || reason === 'timeout') {
      this.sessions.delete(session.id)
      return
    }
    // ssh2 emits this before it closes the client's channels, so terminals can wait on it.
    session.closing = this.afterClientClosed(session)
  }

  /** Reconnects when the profile asks for it, otherwise gives the session up (BL-41). */
  private static async afterClientClosed(session: SSHSession): Promise<void> {
    let autoReconnect = false
    try {
      const profile = await prisma.profile.findUnique({ where: { id: session.profileId } })
      autoReconnect = profile?.autoReconnect === true
    } catch (err) {
      logger.error('Could not read autoReconnect: ' + String(err))
    }
    if (session.removed) return
    if (autoReconnect && this.RECONNECT_DELAYS_MS.length > 0) {
      session.state = 'reconnecting'
      session.events.emit('reconnecting')
      void this.reconnect(session)
    } else {
      this.markLost(session)
    }
  }

  /** A reconnect was given up: the session is removed and terminals close with 4002. */
  private static markLost(session: SSHSession): void {
    session.lost = true
    this.sessions.delete(session.id)
    SftpService.closeSession(session.id).catch(() => {})
    TunnelService.cleanupSession(session.id)
    session.events.emit('lost')
  }

  private static async reconnect(session: SSHSession): Promise<void> {
    let cancelled: 'removed' | 'locked' | null = null
    let wake: () => void = () => {}
    session.cancelReconnect = (reason) => {
      cancelled ??= reason
      wake()
    }
    const stopListeningForLock = AppLockService.onLock(() => session.cancelReconnect?.('locked'))
    let lastError = 'Could not reconnect'

    try {
      for (const delay of this.RECONNECT_DELAYS_MS) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay)
          wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
        if (cancelled === 'removed' || session.removed) return
        if (cancelled === 'locked') {
          lastError = 'app locked'
          break
        }
        try {
          const profile = await prisma.profile.findUnique({ where: { id: session.profileId } })
          if (!profile) {
            lastError = 'the profile no longer exists'
            break
          }
          const client = await this.connectClient(profile, {}, false)
          if (session.removed || cancelled) {
            client.end()
            if (session.removed) return
            lastError = 'app locked'
            break
          }
          session.client = client
          session.endReason = undefined
          session.endError = undefined
          session.clientStartedAt = Date.now()
          session.closing = undefined
          session.hasTcpListener = false
          this.attachClient(session, client)
          session.state = 'connected'
          AuditService.logReconnect(profile, true).catch(console.error)
          await TunnelService.restoreRemoteForwards(session).catch((err) =>
            logger.error('Could not restore remote forwards: ' + String(err))
          )
          session.events.emit('reconnected')
          return
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          // A new or changed host key is never accepted without the user (BL-38).
          if (err instanceof HostKeyError) break
        }
      }
      if (session.removed) return
      AuditService.logReconnect(
        { id: session.profileId, name: session.profileName, host: session.host },
        false,
        lastError
      ).catch(console.error)
      this.markLost(session)
    } finally {
      stopListeningForLock()
      session.cancelReconnect = undefined
    }
  }

  /** FR-02.6 / BL-41: wait before each reconnect attempt; the length is the number of attempts. */
  static RECONNECT_DELAYS_MS: number[] = [1000, 2000, 4000]

  static getSession(sessionId: string): SSHSession | undefined {
    return this.sessions.get(sessionId)
  }

  /** Closes a session. `reason` is recorded in its disconnect log entry (FR-08.2). */
  static removeSession(sessionId: string, reason: DisconnectReason = 'user'): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.removed = true
      session.endReason ??= reason
      session.cancelReconnect?.('removed')
      session.client.end()
      this.sessions.delete(sessionId)
      if (session.state === 'reconnecting') session.events.emit('closed')
    }
    // Clean up cached SFTP client (FUN-03) and tunnel servers (FUN-05)
    SftpService.closeSession(sessionId).catch(() => {})
    TunnelService.cleanupSession(sessionId)
  }
}
