import { prisma } from '../config/db'

/** FUN-13: Resolve an SSH key by name, return its id or null. */
async function resolveLinkedKey(keyName: string | undefined): Promise<string | null> {
  if (!keyName) return null
  const key = await prisma.sSHKey.findFirst({ where: { name: keyName } })
  return key?.id ?? null
}

export interface ExportedTunnel {
  type: string
  localPort: number
  remoteHost: string | null
  remotePort: number | null
  autoStart: boolean
  label: string | null
}

export interface ExportedProfile {
  name: string
  host: string
  port: number
  username: string
  authMethod: string
  group: string | null
  terminalTheme: string
  fontSize: number
  autoReconnect: boolean
  linkedKeyName?: string
  tunnels: ExportedTunnel[]
}

export interface ExportBundle {
  version: string
  exportedAt: string
  profiles: ExportedProfile[]
}

export type ConflictResolution = 'skip' | 'rename' | 'overwrite'

export class ProfileService {
  static async buildExportPayload(ids?: string[]): Promise<ExportBundle> {
    const where = ids && ids.length > 0 ? { id: { in: ids } } : {}
    const profiles = await prisma.profile.findMany({
      where,
      include: {
        tunnels: true,
        sshKey: { select: { name: true } }
      },
      orderBy: { name: 'asc' }
    })

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      profiles: profiles.map((p) => ({
        name: p.name,
        host: p.host,
        port: p.port,
        username: p.username,
        authMethod: p.authMethod,
        group: p.group,
        terminalTheme: p.terminalTheme,
        fontSize: p.fontSize,
        autoReconnect: p.autoReconnect,
        ...(p.sshKey ? { linkedKeyName: p.sshKey.name } : {}),
        tunnels: p.tunnels.map((t) => ({
          type: t.type,
          localPort: t.localPort,
          remoteHost: t.remoteHost,
          remotePort: t.remotePort,
          autoStart: t.autoStart,
          label: t.label
        }))
      }))
    }
  }

  static async checkImportConflicts(profiles: ExportedProfile[]): Promise<string[]> {
    const names = profiles.map((p) => p.name)
    const existing = await prisma.profile.findMany({
      where: { name: { in: names } },
      select: { name: true }
    })
    return existing.map((p) => p.name)
  }

  static async applyImport(
    profiles: ExportedProfile[],
    resolutions: Record<string, ConflictResolution>
  ): Promise<{ created: number; skipped: number; overwritten: number }> {
    let created = 0
    let skipped = 0
    let overwritten = 0

    for (const p of profiles) {
      const existing = await prisma.profile.findFirst({ where: { name: p.name } })
      const resolution = resolutions[p.name] as ConflictResolution | undefined

      if (existing && resolution === 'skip') {
        skipped++
        continue
      }

      if (existing && resolution === 'overwrite') {
        const linkedKeyId = await resolveLinkedKey(p.linkedKeyName)
        await prisma.profile.update({
          where: { id: existing.id },
          data: {
            host: p.host,
            port: p.port,
            username: p.username,
            authMethod: p.authMethod,
            group: p.group ?? null,
            terminalTheme: p.terminalTheme,
            fontSize: p.fontSize,
            autoReconnect: p.autoReconnect,
            sshKeyId: linkedKeyId,
            encryptedPassword: null
          }
        })
        await prisma.tunnel.deleteMany({ where: { profileId: existing.id } })
        if (p.tunnels.length > 0) {
          await prisma.tunnel.createMany({
            data: p.tunnels.map((t) => ({ ...t, profileId: existing.id }))
          })
        }
        overwritten++
        continue
      }

      let name = p.name
      if (existing && resolution === 'rename') {
        let suffix = 1
        while (await prisma.profile.findFirst({ where: { name: `${p.name} (${suffix})` } })) {
          suffix++
        }
        name = `${p.name} (${suffix})`
      }

      const linkedKeyId = await resolveLinkedKey(p.linkedKeyName)
      const newProfile = await prisma.profile.create({
        data: {
          name,
          host: p.host,
          port: p.port,
          username: p.username,
          authMethod: p.authMethod,
          group: p.group ?? null,
          terminalTheme: p.terminalTheme ?? 'dark',
          fontSize: p.fontSize ?? 14,
          autoReconnect: p.autoReconnect ?? true,
          sshKeyId: linkedKeyId,
          encryptedPassword: null
        }
      })

      if (p.tunnels.length > 0) {
        await prisma.tunnel.createMany({
          data: p.tunnels.map((t) => ({ ...t, profileId: newProfile.id }))
        })
      }
      created++
    }

    return { created, skipped, overwritten }
  }
}
