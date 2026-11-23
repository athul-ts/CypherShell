import type { Tunnel } from '@prisma/client'
import { prisma } from '../config/db'

export interface TunnelRuleInput {
  type: 'local' | 'remote' | 'dynamic'
  localPort: number
  /** Only local forwards have a remote host. */
  remoteHost: string | null
  /** Dynamic (SOCKS5) forwards have no remote port. */
  remotePort: number | null
  label: string | null
}

export class ProfileNotFoundError extends Error {
  constructor() {
    super('Profile not found')
    this.name = 'ProfileNotFoundError'
  }
}

export class DuplicateTunnelRuleError extends Error {
  constructor() {
    super('This tunnel is already saved for the profile')
    this.name = 'DuplicateTunnelRuleError'
  }
}

/** Saved port-forwarding rules of a profile (FR-06.4, BL-34). */
export class TunnelRuleService {
  private static async requireProfile(profileId: string): Promise<void> {
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: { id: true }
    })
    if (!profile) throw new ProfileNotFoundError()
  }

  static async list(profileId: string): Promise<Tunnel[]> {
    await this.requireProfile(profileId)
    return prisma.tunnel.findMany({ where: { profileId }, orderBy: { localPort: 'asc' } })
  }

  static async create(profileId: string, input: TunnelRuleInput): Promise<Tunnel> {
    await this.requireProfile(profileId)
    const duplicate = await prisma.tunnel.findFirst({
      where: {
        profileId,
        type: input.type,
        localPort: input.localPort,
        remoteHost: input.remoteHost,
        remotePort: input.remotePort
      }
    })
    if (duplicate) throw new DuplicateTunnelRuleError()
    return prisma.tunnel.create({ data: { ...input, profileId } })
  }

  /** Deletes a rule of this profile; false if it does not exist (or belongs to another profile). */
  static async remove(profileId: string, tunnelId: string): Promise<boolean> {
    const { count } = await prisma.tunnel.deleteMany({ where: { id: tunnelId, profileId } })
    return count > 0
  }
}
