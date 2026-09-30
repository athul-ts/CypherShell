import { prisma } from '../config/db'
import { AuditLog, Prisma } from '@prisma/client'

type AuditLogWithProfile = Prisma.AuditLogGetPayload<{
  include: { profile: { select: { name: true } } }
}>

export class AuditService {
  static async logConnection(
    profileId: string | null,
    profileName: string | null,
    host: string | null,
    success: boolean,
    errorMessage?: string
  ): Promise<AuditLog> {
    return prisma.auditLog.create({
      data: {
        type: 'connection',
        profileId,
        profileName,
        host,
        detail: success ? 'Connected successfully' : 'Connection failed',
        success,
        errorMessage
      }
    })
  }

  static async logDisconnect(
    profileId: string | null,
    profileName: string | null,
    host: string | null,
    reason: string,
    durationMs?: number
  ): Promise<AuditLog> {
    return prisma.auditLog.create({
      data: {
        type: 'disconnection',
        profileId,
        profileName,
        host,
        detail: `Disconnected: ${reason}`,
        success: true,
        durationMs
      }
    })
  }

  static async logSftpTransfer(
    profileId: string | null,
    type: 'sftp_upload' | 'sftp_download',
    detail: string,
    success: boolean,
    fileSizeBytes?: number,
    errorMessage?: string,
    profileName?: string, // FUN-17
    host?: string // FUN-17
  ): Promise<AuditLog> {
    return prisma.auditLog.create({
      data: {
        type,
        profileId,
        profileName,
        host,
        detail,
        success,
        fileSizeBytes,
        errorMessage
      }
    })
  }

  static async getLogs(limit: number = 100): Promise<AuditLogWithProfile[]> {
    return prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        profile: { select: { name: true } }
      }
    })
  }

  static async exportCSV(): Promise<string> {
    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' }
    })

    const header = 'Timestamp,Type,Profile,Host,Detail,Success,Error,Size\n'
    const rows = logs.map((log) => {
      const time = log.timestamp.toISOString()
      const type = log.type
      const profile = `"${log.profileName || ''}"`
      const host = `"${log.host || ''}"`
      const detail = `"${log.detail.replace(/"/g, '""')}"`
      const success = log.success ? 'Yes' : 'No'
      const error = `"${log.errorMessage || ''}"`
      const size = log.fileSizeBytes || ''
      return `${time},${type},${profile},${host},${detail},${success},${error},${size}`
    })

    return header + rows.join('\n')
  }

  static async clearAllLogs(): Promise<Prisma.BatchPayload> {
    return prisma.auditLog.deleteMany({})
  }

  static async clearOldLogs(retentionDays: number): Promise<Prisma.BatchPayload> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - retentionDays)

    return prisma.auditLog.deleteMany({
      where: {
        timestamp: { lt: cutoff }
      }
    })
  }
}
