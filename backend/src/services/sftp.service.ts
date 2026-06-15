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
    const session = SSHService.getSession(sessionId)
    if (!session) throw new Error('Invalid session ID')

    // Re-use the existing ssh2 client connection.
    // However, ssh2-sftp-client's connect expects config. If we pass the client object it uses it.
    // Wait, ssh2-sftp-client allows using an existing ssh2 client?
    // Let's create a new connection using the same profile for simplicity right now, or use the ssh2 client.
    // Actually, creating a new connection for SFTP is safer to prevent blocking the terminal multiplexer.

    // Instead of using ssh2-sftp-client with an existing client (which is sometimes flaky),
    // we'll just connect using the same credentials.
    // But since password might not be available here directly (we don't have the Profile here),
    // let's fetch the profile or just pass the ssh2 client.

    // According to ssh2-sftp-client docs, you can't easily pass an already connected ssh2.Client to `connect()`,
    // but you can just use `sftp.client = session.client` and then `sftp.sftp(callback)`.
    // Actually, `ssh2-sftp-client` doesn't natively support reusing an existing SSH2 Client created outside easily in v9+.
    // We will do a hack for now, or better: just let the user open an SFTP channel on the existing SSH2 connection natively.

    // Let's use the underlying ssh2 client's SFTP subsystem directly to get a wrapped SftpClient!
    return new Promise((resolve, reject) => {
      session.client.sftp((err, sftpStream) => {
        if (err) return reject(err)

        // We will wrap this sftpStream using a new instance of SftpClient
        // Wait, ssh2-sftp-client expects a connection config.
        // We can just use the raw ssh2 sftpStream for directory listing for now.
        // Or we can construct SftpClient and overwrite its `sftp` property.

        const client = new SftpClient()
        ;(client as unknown as { sftp: SFTPWrapper }).sftp = sftpStream
        ;(client as unknown as { client: typeof session.client }).client = session.client

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

  static async upload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    transferId: string
  ): Promise<void> {
    const sftp = await this.getClient(sessionId)
    const stream = getStream(sftp)
    this.activeTransfers.set(transferId, stream)

    return new Promise<void>((resolve, reject) => {
      stream.fastPut(
        localPath,
        remotePath,
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
          if (err) {
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
              err.message
            ).catch(console.error)
            return reject(err)
          }
          this.transferEvents.emit(transferId, { transferId, status: 'complete', percent: 100 })
          fs.stat(localPath, (_statErr, stats) => {
            AuditService.logSftpTransfer(
              profileId,
              'sftp_upload',
              `Uploaded ${localPath} to ${remotePath}`,
              true,
              stats?.size
            ).catch(console.error)
          })
          resolve()
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
              err.message
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
              stats?.size
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
