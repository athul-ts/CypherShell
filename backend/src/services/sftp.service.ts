import SftpClient from 'ssh2-sftp-client'
import { Client, FileEntryWithStats, SFTPWrapper } from 'ssh2'
import { SSHService } from './ssh.service'
import { AuditService } from './audit.service'
import EventEmitter from 'events'
import fs from 'fs'
import { logger } from './logger.service'

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

/** One in-flight upload or download and the SFTP channel dedicated to it. */
interface ActiveTransfer {
  channel: SFTPWrapper
  /** Releases the channel and the session consumer; safe to call more than once. */
  finish: (abort?: boolean) => void
  /** Extra clean-up when the transfer is cancelled (e.g. removing a partial upload). */
  onCancel?: () => void
}

function openSftpChannel(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
  })
}

export class SftpService {
  static transferEvents = new EventEmitter()
  static {
    SftpService.transferEvents.setMaxListeners(100)
  } // CODE-07
  /**
   * transferId → its dedicated SFTP channel. Each transfer opens its own
   * channel so cancelling one destroys only that channel, never the session's
   * shared listing channel or another transfer's (BL-14).
   */
  static activeTransfers = new Map<string, ActiveTransfer>()
  // Transfers explicitly cancelled — guards against emitting 'error' after cancel
  static cancelledTransfers = new Set<string>()

  // FUN-03: Cache one long-lived SFTP client per sessionId for listings and
  // file operations, instead of opening a new channel on every request.
  private static sftpClients = new Map<string, SftpClient>()

  static async closeSession(sessionId: string): Promise<void> {
    const client = this.sftpClients.get(sessionId)
    if (client) {
      this.sftpClients.delete(sessionId)
      try {
        await client.end()
      } catch {
        /* ignore close errors */
      }
    }
  }

  static cancelTransfer(transferId: string): void {
    this.cancelledTransfers.add(transferId)
    this.transferEvents.emit(transferId, { transferId, status: 'cancelled' })
    const transfer = this.activeTransfers.get(transferId)
    if (transfer) {
      transfer.onCancel?.()
      transfer.finish(true)
    }
    // CODE-02: Safety cleanup — remove cancelled id after 30s in case
    // the transfer-completion callback never fires after the channel is destroyed.
    setTimeout(() => {
      this.cancelledTransfers.delete(transferId)
    }, 30_000).unref()
  }

  /**
   * Opens a dedicated SFTP channel for one transfer and counts the transfer
   * as a session consumer until it finishes (BL-11, BL-14).
   */
  private static async beginTransfer(
    sessionId: string,
    transferId: string
  ): Promise<ActiveTransfer> {
    const session = SSHService.getSession(sessionId)
    if (!session) throw new Error('Invalid session ID')
    const channel = await openSftpChannel(session.client)
    channel.on('error', () => {
      /* surfaced through the transfer callback */
    })
    SSHService.acquire(sessionId)

    let finished = false
    const transfer: ActiveTransfer = {
      channel,
      finish: (abort = false) => {
        if (finished) return
        finished = true
        this.activeTransfers.delete(transferId)
        SSHService.release(sessionId)
        try {
          if (abort) channel.destroy()
          else channel.end()
        } catch {
          /* channel already closed */
        }
      }
    }
    this.activeTransfers.set(transferId, transfer)
    return transfer
  }

  /** Removes a remote file through the shared channel, ignoring failures. */
  private static removeRemoteQuietly(sessionId: string, remotePath: string): void {
    this.getClient(sessionId)
      .then((client) => getStream(client).unlink(remotePath, () => {}))
      .catch(() => {})
  }

  private static emitTransferError(transferId: string, err: unknown): void {
    this.transferEvents.emit(transferId, {
      transferId,
      status: 'error',
      message: err instanceof Error ? err.message : String(err)
    })
  }

  static async getClient(sessionId: string): Promise<SftpClient> {
    // Return cached client if available (FUN-03)
    const cached = this.sftpClients.get(sessionId)
    if (cached) return cached

    const session = SSHService.getSession(sessionId)
    if (!session) throw new Error('Invalid session ID')

    const sftpStream = await openSftpChannel(session.client)

    // Cast hack: ssh2-sftp-client hides its backing ssh2 SFTPWrapper/client.
    // We stash them to reuse the SSH connection (FUN-03).
    const client = new SftpClient()
    ;(client as unknown as { sftp: SFTPWrapper }).sftp = sftpStream
    ;(client as unknown as { client: typeof session.client }).client = session.client

    // Cache the client for reuse (FUN-03). If its channel closes for any
    // reason, drop it so the next operation opens a fresh one (BL-14).
    this.sftpClients.set(sessionId, client)
    const evict = (): void => {
      if (this.sftpClients.get(sessionId) === client) this.sftpClients.delete(sessionId)
    }
    sftpStream.on('close', evict)
    sftpStream.on('error', evict)
    session.client.once('close', () => {
      this.closeSession(sessionId).catch(() => {})
    })

    return client
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
    let transfer: ActiveTransfer
    try {
      transfer = await this.beginTransfer(sessionId, transferId)
    } catch (err) {
      this.emitTransferError(transferId, err)
      throw err
    }
    const stream = transfer.channel
    const tempPath = `${remotePath}.partial`
    transfer.onCancel = () => this.removeRemoteQuietly(sessionId, tempPath)

    const session = SSHService.getSession(sessionId)
    const profileId = session?.profileId || null
    const profileName = session?.profileName
    const host = session?.host

    const logFailure = (message: string): void => {
      AuditService.logSftpTransfer(
        profileId,
        'sftp_upload',
        `Failed upload to ${remotePath}`,
        false,
        0,
        message,
        profileName,
        host
      ).catch((e) => logger.error('Audit log failed: ' + String(e)))
    }

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
          if (this.cancelledTransfers.has(transferId)) {
            this.cancelledTransfers.delete(transferId)
            transfer.finish(true)
            return resolve()
          }
          if (err) {
            stream.unlink(tempPath, () => transfer.finish())
            this.emitTransferError(transferId, err)
            logFailure(err.message)
            return reject(err)
          }
          // Rename temp → target on success
          stream.rename(tempPath, remotePath, (renameErr?: Error | null) => {
            if (renameErr) {
              // Without this event the UI would wait on the SSE stream forever.
              stream.unlink(tempPath, () => transfer.finish())
              this.emitTransferError(transferId, renameErr)
              logFailure(renameErr.message)
              return reject(renameErr)
            }
            transfer.finish()
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
              ).catch((e) => logger.error('Audit log failed: ' + String(e)))
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
    let transfer: ActiveTransfer
    try {
      transfer = await this.beginTransfer(sessionId, transferId)
    } catch (err) {
      this.emitTransferError(transferId, err)
      throw err
    }
    const stream = transfer.channel

    const session = SSHService.getSession(sessionId)
    const profileId = session?.profileId || null
    const profileName = session?.profileName
    const host = session?.host

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
          if (this.cancelledTransfers.has(transferId)) {
            this.cancelledTransfers.delete(transferId)
            transfer.finish(true)
            return resolve()
          }
          transfer.finish()
          if (err) {
            this.emitTransferError(transferId, err)
            AuditService.logSftpTransfer(
              profileId,
              'sftp_download',
              `Failed download from ${remotePath}`,
              false,
              0,
              err.message,
              profileName,
              host
            ).catch((e) => logger.error('Audit log failed: ' + String(e)))
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
            ).catch((e) => logger.error('Audit log failed: ' + String(e)))
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
