import { prisma } from '../config/db'
import { AuditLog, Prisma } from '@prisma/client'

type AuditLogWithProfile = Prisma.AuditLogGetPayload<{
  include: { profile: { select: { name: true } } }
}>

/**
 * RFC 4180 field: quoted, inner quotes doubled — `"`, `,` and line breaks survive (BL-28).
 * A value a spreadsheet would run as a formula (it starts with `=`, `+`, `-`, `@`, tab or
 * carriage return) gets a leading single quote, so error text from a remote server cannot
 * execute when the export is opened (BL-32).
 */
export function csvField(value: string | null | undefined): string {
  let text = value ?? ''
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** Why an SSH session ended (FR-08.2). */
export type DisconnectReason = 'user' | 'timeout' | 'error' | 'closed'

const DISCONNECT_REASON_TEXT: Record<DisconnectReason, string> = {
  user: 'closed by user',
  timeout: 'idle timeout',
  error: 'connection error',
  closed: 'closed by remote'
}

export const AUDIT_TYPES = [
  'connection',
  'disconnection',
  'sftp_upload',
  'sftp_download',
  'key_used',
  'host_key'
] as const

export interface AuditQuery {
  page: number
  pageSize: number
  type?: (typeof AUDIT_TYPES)[number]
  from?: Date
  to?: Date
  q?: string
}

export interface AuditPage {
  items: AuditLogWithProfile[]
  /** Entries matching the filters, across all pages. */
  total: number
  page: number
  pageSize: number
}

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
    reason: DisconnectReason,
    durationMs?: number,
    errorMessage?: string
  ): Promise<AuditLog> {
    return prisma.auditLog.create({
      data: {
        type: 'disconnection',
        profileId,
        profileName,
        host,
        detail: `Disconnected: ${DISCONNECT_REASON_TEXT[reason]}`,
        success: reason !== 'error',
        errorMessage,
        durationMs
      }
    })
  }

  /** BL-41 / FR-02.6: the outcome of an automatic reconnect. */
  static async logReconnect(
    profile: { id: string; name: string; host: string },
    success: boolean,
    errorMessage?: string
  ): Promise<AuditLog> {
    return prisma.auditLog.create({
      data: {
        type: 'connection',
        profileId: profile.id,
        profileName: profile.name,
        host: profile.host,
        detail: success ? 'Reconnected after connection loss' : 'Reconnect failed',
        success,
        errorMessage
      }
    })
  }

  /** BL-38 / FR-11.5: a host-key decision (prompted, trusted, blocked, removed). */
  static async logHostKey(
    profile: { id: string; name: string; host: string } | null,
    detail: string,
    success: boolean,
    errorMessage?: string,
    host?: string
  ): Promise<AuditLog> {
    return prisma.auditLog.create({
      data: {
        type: 'host_key',
        profileId: profile?.id ?? null,
        profileName: profile?.name ?? null,
        host: profile?.host ?? host ?? null,
        detail,
        success,
        errorMessage
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

  /** One page of entries, newest first, filtered on the server (FR-08.5). */
  static async queryLogs({ page, pageSize, type, from, to, q }: AuditQuery): Promise<AuditPage> {
    const where: Prisma.AuditLogWhereInput = {
      ...(type && { type }),
      ...((from || to) && { timestamp: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
      ...(q && {
        OR: [
          { detail: { contains: q } },
          { type: { contains: q } },
          { profileName: { contains: q } },
          { host: { contains: q } },
          { errorMessage: { contains: q } }
        ]
      })
    }
    const [total, items] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { profile: { select: { name: true } } }
      })
    ])
    return { items, total, page, pageSize }
  }

  static async exportCSV(): Promise<string> {
    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' }
    })

    const header = 'Timestamp,Type,Profile,Host,Detail,Success,Error,Size\n'
    const rows = logs.map((log) => {
      const time = log.timestamp.toISOString()
      const type = log.type
      const profile = csvField(log.profileName)
      const host = csvField(log.host)
      const detail = csvField(log.detail)
      const success = log.success ? 'Yes' : 'No'
      const error = csvField(log.errorMessage)
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
