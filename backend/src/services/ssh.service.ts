import { randomUUID } from 'crypto'
import { Client, ConnectConfig } from 'ssh2'
import { Profile } from '@prisma/client'
import { CryptoService } from './crypto.service'
import { prisma } from '../config/db'
import { AuditService } from './audit.service'

export interface SSHSession {
  id: string
  client: Client
  profileId: string
  profileName: string
  host: string
  connectedAt: Date
  hasTcpListener?: boolean
}

export class SSHService {
  private static sessions = new Map<string, SSHSession>()

  static async createSession(profile: Profile): Promise<SSHSession> {
    const client = new Client()
    const sessionId = `session-${randomUUID()}`

    const connectConfig: ConnectConfig = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
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

      const privateKey = CryptoService.decrypt(sshKey.encryptedPrivateKey)
      connectConfig.privateKey = privateKey

      if (profile.authMethod === 'key+passphrase') {
        if (!profile.encryptedPassword) throw new Error('Passphrase required but missing')
        connectConfig.passphrase = CryptoService.decrypt(profile.encryptedPassword)
      }
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
          connectedAt
        }
        this.sessions.set(sessionId, session)
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
  }
}
