import { randomUUID } from 'crypto'
import { Client, ConnectConfig } from 'ssh2'
import { Profile } from '@prisma/client'
import { CryptoService } from './crypto.service'
import { prisma } from '../config/db'
import { AuditService } from './audit.service'
import { SftpService } from './sftp.service'
import { TunnelService } from './tunnel.service'
import { KeyService } from './key.service'

export interface SSHSession {
  id: string
  client: Client
  profileId: string
  profileName: string
  host: string
  connectedAt: Date
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
        this.removeSession(id)
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

  static async createSession(profile: Profile): Promise<SSHSession> {
    const client = new Client()
    const sessionId = `session-${randomUUID()}`

    const connectConfig: ConnectConfig = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      readyTimeout: 10000, // FUN-09: timeout after 10s instead of ~20s default
      keepaliveInterval: 10000,
      keepaliveCountMax: 3
    }

    if (profile.authMethod === 'password') {
      if (!profile.encryptedPassword) throw new Error('Password required but missing')
      const plainPassword = CryptoService.decrypt(profile.encryptedPassword)
      connectConfig.password = plainPassword
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
      client.on('ready', () => {
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

        client.on('close', () => {
          const durationMs = Date.now() - connectedAt.getTime()
          AuditService.logDisconnect(
            profile.id,
            profile.name,
            profile.host,
            'Connection closed',
            durationMs
          ).catch(console.error)
          this.sessions.delete(sessionId)
        })

        client.on('error', (postConnectErr) => {
          const durationMs = Date.now() - connectedAt.getTime()
          AuditService.logDisconnect(
            profile.id,
            profile.name,
            profile.host,
            postConnectErr.message,
            durationMs
          ).catch(console.error)
        })

        resolve(session)
      })

      client.on('error', (err) => {
        AuditService.logConnection(
          profile.id,
          profile.name,
          profile.host,
          false,
          err.message
        ).catch(console.error)
        reject(err)
      })

      client.connect(connectConfig)
    })
  }

  static getSession(sessionId: string): SSHSession | undefined {
    return this.sessions.get(sessionId)
  }

  static removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.client.end()
      this.sessions.delete(sessionId)
    }
    // Clean up cached SFTP client (FUN-03) and tunnel servers (FUN-05)
    SftpService.closeSession(sessionId).catch(() => {})
    TunnelService.cleanupSession(sessionId)
  }
}
