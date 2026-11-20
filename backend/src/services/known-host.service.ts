import { createHash } from 'crypto'
import type { KnownHost } from '@prisma/client'
import { prisma } from '../config/db'

/** What the server presented, and (for a mismatch) what is stored. (BL-38) */
export interface HostKeyDetails {
  host: string
  port: number
  keyType: string
  fingerprint: string
  knownKeyType?: string
  knownFingerprint?: string
}

export type HostKeyErrorCode = 'HOST_KEY_UNKNOWN' | 'HOST_KEY_MISMATCH'

/** The handshake was stopped because the host key is new or has changed. */
export class HostKeyError extends Error {
  constructor(
    public readonly code: HostKeyErrorCode,
    public readonly details: HostKeyDetails
  ) {
    super(
      code === 'HOST_KEY_UNKNOWN'
        ? `The host key of ${details.host}:${details.port} is not trusted yet`
        : `The host key of ${details.host}:${details.port} has changed`
    )
    this.name = 'HostKeyError'
  }
}

export type HostKeyOutcome = 'trusted' | 'accepted' | 'unknown' | 'mismatch'

export interface HostKeyCheck {
  outcome: HostKeyOutcome
  presented: { keyType: string; fingerprint: string }
  known?: { keyType: string; fingerprint: string }
}

/** `SHA256:` + base64 without padding, as OpenSSH prints it. */
export function fingerprintOf(blob: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

/** The algorithm name at the start of an SSH public-key blob (length-prefixed string). */
export function keyTypeOf(blob: Buffer): string {
  if (blob.length < 4) throw new Error('Malformed host key')
  const len = blob.readUInt32BE(0)
  if (len === 0 || 4 + len > blob.length) throw new Error('Malformed host key')
  return blob.toString('latin1', 4, 4 + len)
}

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

export class KnownHostService {
  /**
   * Compares the key a server presented with the stored one. `acceptFingerprint`
   * is the fingerprint the user confirmed: the key is stored only if the server
   * presented exactly that one, and never over a different stored key.
   */
  static async check(
    rawHost: string,
    port: number,
    blob: Buffer,
    acceptFingerprint?: string
  ): Promise<HostKeyCheck> {
    const host = normalizeHost(rawHost)
    const presented = { keyType: keyTypeOf(blob), fingerprint: fingerprintOf(blob) }
    const stored = await prisma.knownHost.findUnique({ where: { host_port: { host, port } } })

    if (stored) {
      const known = { keyType: stored.keyType, fingerprint: stored.fingerprint }
      if (stored.fingerprint === presented.fingerprint && stored.keyType === presented.keyType) {
        await prisma.knownHost.update({
          where: { id: stored.id },
          data: { lastSeenAt: new Date() }
        })
        return { outcome: 'trusted', presented, known }
      }
      return { outcome: 'mismatch', presented, known }
    }

    if (acceptFingerprint && acceptFingerprint === presented.fingerprint) {
      await prisma.knownHost.create({
        data: {
          host,
          port,
          keyType: presented.keyType,
          fingerprint: presented.fingerprint,
          publicKey: blob.toString('base64')
        }
      })
      return { outcome: 'accepted', presented }
    }
    return { outcome: 'unknown', presented }
  }

  static list(): Promise<KnownHost[]> {
    return prisma.knownHost.findMany({ orderBy: { lastSeenAt: 'desc' } })
  }

  static findById(id: string): Promise<KnownHost | null> {
    return prisma.knownHost.findUnique({ where: { id } })
  }

  static async remove(id: string): Promise<boolean> {
    const { count } = await prisma.knownHost.deleteMany({ where: { id } })
    return count > 0
  }
}
