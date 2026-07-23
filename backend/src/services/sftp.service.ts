import SftpClient from 'ssh2-sftp-client'
import { FileEntryWithStats, SFTPWrapper } from 'ssh2'
import { SSHService } from './ssh.service'
import { AuditService } from './audit.service'
import EventEmitter from 'events'
import fs from 'fs'

// Shape of a single entry returned by SftpService.list()
interface SftpFileInfo {
  name: string
  type: 'd' | '-'
  size: number
  modifyTime: number
  accessTime: number
  permissions: number
}

// The raw ssh2 SFTPWrapper is stashed on the SftpClient instance's `sftp`
// property by getClient(); this helper reads it back with an accurate type.
function getStream(client: SftpClient): SFTPWrapper {
  return (client as unknown as { sftp: SFTPWrapper }).sftp
}

export class SftpService {
  static transferEvents = new EventEmitter()
  // Maps transferId → the raw ssh2 SFTPWrapper so cancelTransfer() can destroy it
  static activeTransfers = new Map<string, SFTPWrapper>()
  // Transfers explicitly cancelled — guards against emitting 'error' after cancel
  static cancelledTransfers = new Set<string>()

  // FUN-03: Cache one long-lived SFTP client per sessionId instead of
  // opening a new SFTP subsystem channel on every operation.
  private static sftpClients = new Map<string, SftpClient>()

  static async closeSession(sessionId: string): Promise<void> {
    const client = this.sftpClients.get(sessionId)
    if (client) {
      try {
        await client.end()
      } catch { /* ignore close errors */ }
      this.sftpClients.delete(sessionId)
    }
  }

  static cancelTransfer(transferId: string): void {
    this.cancelledTransfers.add(transferId)
    this.transferEvents.emit(transferId, { transferId, status: 'cancelled' })
    const stream = this.activeTransfers.get(transferId)
    if (stream) {
      stream.destroy()
      this.activeTransfers.delete(transferId)
    }
  }

  static async getClient(sessionId: string): Promise<SftpClient> {
    // Return cached client if available (FUN-03)
    const cached = this.sftpClients.get(sessionId)
    if (cached) return cached

    const session = SSHService.getSession(sessionId)
    if (!session) throw new Error('Invalid session ID')

    return new Promise((resolve, reject) => {
      session.client.sftp((err, sftpStream) => {
        if (err) return reject(err)

        const client = new SftpClient()
        ;(client as unknown as { sftp: SFTPWrapper }).sftp = sftpStream
        ;(client as unknown as { client: typeof session.client }).client = session.client

        // Cache the client for reuse (FUN-03)
        this.sftpClients.set(sessionId, client)

        // Clean up the cached client when the SSH connection drops
        session.client.on('close', () => {
          this.closeSession(sessionId).catch(() => {})
        })

        resolve(client)
      })
    })
  }

  static async list(
    sessionId: string,
    targetPath: string = '.',
    showHidden: boolean = false
  ): Promise<SftpFileInfo[]> {
    const sftp = await this.getClient(sessionId)
    const stream = getStream(sftp)

    return new Promise((resolve, reject) => {
      stream.readdir(targetPath, (err: Error | undefined, list: FileEntryWithStats[]) => {
        if (err) return reject(err)

        const files: SftpFileInfo[] = list
          .filter((item) => showHidden || !item.filename.startsWith('.'))
          .map((item) => ({
            name: item.filename,
            type: item.longname.startsWith('d') ? 'd' : '-',
            size: item.attrs.size,
            modifyTime: item.attrs.mtime * 1000,
            accessTime: item.attrs.atime * 1000,
            permissions: item.attrs.mode
          }))

        resolve(files)
      })
    })
  }

  /** FUN-15: Upload to a temp path, then rename on success; clean up on error/cancel. */
  static async upload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    transferId: string
  ): Promise<void> {
    const sftp = await this.getClient(sessionId)
    const stream = getStream(sftp)
    this.activeTransfers.set(transferId, stream)
    const tempPath = `${remotePath}.partial`

    return new Promise<void>((resolve, reject) => {
      stream.fastPut(
        localPath,
        tempPath,
        {
          step: (total_transferred: number, _chunk: number, total: number) => {
            if (this.cancelledTransfers.has(transferId)) return
            this.transferEvents.emit(transferId, {
              transferId,
              status: 'progress',
              bytesTransferred: total_transferred,
              totalBytes: total,
              percent: Math.floor((total_transferred / total) * 100)
            })
          }
        },
        (err?: Error | null) => {
          this.activeTransfers.delete(transferId)
          const cleanup = (): void => { stream.unlink(tempPath, () => {}) }
          if (this.cancelledTransfers.has(transferId)) {
            this.cancelledTransfers.delete(transferId)
            cleanup()
            return resolve()
          }
          const session = SSHService.getSession(sessionId)
          const profileId = session?.profileId || null
          const profileName = session?.profileName
          const host = session?.host
          if (err) {
            cleanup()
            this.transferEvents.emit(transferId, {
              transferId,
              status: 'error',
              message: err.message
            })
            AuditService.logSftpTransfer(
              profileId,
              'sftp_upload',
              `Failed upload to ${remotePath}`,
              false,
              0,
              err.message,
              profileName,
              host
            ).catch(console.error)
            return reject(err)
          }
          // Rename temp → target on success
          stream.rename(tempPath, remotePath, (renameErr?: Error | null) => {
            if (renameErr) {
              cleanup()
              return reject(renameErr)
            }
            this.transferEvents.emit(transferId, { transferId, status: 'complete', percent: 100 })
            fs.stat(localPath, (_statErr, stats) => {
              AuditService.logSftpTransfer(
                profileId,
                'sftp_upload',
                `Uploaded ${localPath} to ${remotePath}`,
                true,
                stats?.size,
                undefined,
                profileName,
                host
              ).catch(console.error)
            })
            resolve()
          })
        }
      )
    })
  }

  static async download(
    sessionId: string,
    remotePath: string,
    localPath: string,
    transferId: string
  ): Promise<void> {
    const sftp = await this.getClient(sessionId)
    const stream = getStream(sftp)
    this.activeTransfers.set(transferId, stream)

    return new Promise<void>((resolve, reject) => {
      stream.fastGet(
        remotePath,
        localPath,
        {
          step: (total_transferred: number, _chunk: number, total: number) => {
            if (this.cancelledTransfers.has(transferId)) return
            this.transferEvents.emit(transferId, {
              transferId,
              status: 'progress',
              bytesTransferred: total_transferred,
              totalBytes: total,
              percent: Math.floor((total_transferred / total) * 100)
            })
          }
        },
        (err?: Error | null) => {
          this.activeTransfers.delete(transferId)
          if (this.cancelledTransfers.has(transferId)) {
            this.cancelledTransfers.delete(transferId)
            return resolve()
          }
          const session = SSHService.getSession(sessionId)
          const profileId = session?.profileId || null
          const profileName = session?.profileName
          const host = session?.host
          if (err) {
            this.transferEvents.emit(transferId, {
              transferId,
              status: 'error',
              message: err.message
            })
            AuditService.logSftpTransfer(
              profileId,
              'sftp_download',
              `Failed download from ${remotePath}`,
              false,
              0,
              err.message,
              profileName,
              host
            ).catch(console.error)
            return reject(err)
          }
          this.transferEvents.emit(transferId, { transferId, status: 'complete', percent: 100 })
          fs.stat(localPath, (_statErr, stats) => {
            AuditService.logSftpTransfer(
              profileId,
              'sftp_download',
              `Downloaded ${remotePath} to ${localPath}`,
              true,
              stats?.size,
              undefined,
              profileName,
              host
            ).catch(console.error)
          })
          resolve()
        }
      )
    })
  }

  static async deleteFile(sessionId: string, remotePath: string): Promise<void> {
    const sftp = await this.getClient(sessionId)
    const stream = getStream(sftp)
    return new Promise<void>((resolve, reject) => {
      stream.unlink(remotePath, (err?: Error | null) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  static async renameFile(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getClient(sessionId)
    const stream = getStream(sftp)
    return new Promise<void>((resolve, reject) => {
      stream.rename(oldPath, newPath, (err?: Error | null) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  static async createDirectory(sessionId: string, remotePath: string): Promise<void> {
    const sftp = await this.getClient(sessionId)
    const stream = getStream(sftp)
    return new Promise<void>((resolve, reject) => {
      stream.mkdir(remotePath, (err?: Error | null) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  static async changePermissions(
    sessionId: string,
    remotePath: string,
    mode: string | number
  ): Promise<void> {
    const sftp = await this.getClient(sessionId)
    const stream = getStream(sftp)
    return new Promise<void>((resolve, reject) => {
      stream.chmod(remotePath, mode, (err?: Error | null) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }
}
