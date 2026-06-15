import { Request, Response } from 'express'
import type { Profile, Tunnel } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/db'
import { CryptoService } from '../services/crypto.service'
import { SSHService } from '../services/ssh.service'
import { ProfileService } from '../services/profile.service'
import type { ExportedProfile, ConflictResolution } from '../services/profile.service'
import { z } from 'zod'

type ProfileWithRelations = Profile & { tunnels?: Tunnel[] }
type SanitizedProfile = Omit<ProfileWithRelations, 'encryptedPassword'> & { hasPassword: boolean }

const ProfileSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1),
  authMethod: z.enum(['password', 'key', 'key+passphrase']),
  password: z.string().optional(),
  sshKeyId: z.string().optional(),
  group: z.string().nullable().optional(),
  terminalTheme: z.string().default('dark'),
  fontSize: z.number().int().default(14),
  autoReconnect: z.boolean().default(true)
})

function sanitizeProfile(profile: ProfileWithRelations): SanitizedProfile {
  const { encryptedPassword, ...rest } = profile
  return { ...rest, hasPassword: !!encryptedPassword }
}

export async function listProfiles(_req: Request, res: Response): Promise<void> {
  const profiles = await prisma.profile.findMany({
    orderBy: { name: 'asc' }
  })
  res.json(profiles.map(sanitizeProfile))
}

export async function getProfile(req: Request, res: Response): Promise<void | Response> {
  const id = req.params.id as string
  const profile = await prisma.profile.findUnique({
    where: { id },
    include: { tunnels: true }
  })
  if (!profile) return res.status(404).json({ error: 'Profile not found' })
  res.json(sanitizeProfile(profile))
}

export async function createProfile(req: Request, res: Response): Promise<void | Response> {
  const result = ProfileSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ error: result.error.issues })

  const { password, ...data } = result.data
  const encryptedPassword = password ? CryptoService.encrypt(password) : null
  const sshKeyId = data.authMethod === 'password' || !data.sshKeyId ? null : data.sshKeyId

  const profile = await prisma.profile.create({
    data: {
      ...data,
      sshKeyId,
      encryptedPassword
    }
  })
  res.status(201).json(sanitizeProfile(profile))
}

export async function updateProfile(req: Request, res: Response): Promise<void | Response> {
  const id = req.params.id as string
  const result = ProfileSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ error: result.error.issues })

  const { password, ...data } = result.data

  // Only update encryptedPassword if a new one is provided.
  // Otherwise, leave the existing one.
  const updateData: Prisma.ProfileUpdateInput | Prisma.ProfileUncheckedUpdateInput = {
    ...data,
    sshKeyId: data.authMethod === 'password' || !data.sshKeyId ? null : data.sshKeyId
  }
  if (password !== undefined) {
    if (password === '') {
      updateData.encryptedPassword = null
    } else {
      updateData.encryptedPassword = CryptoService.encrypt(password)
    }
  }

  try {
    const profile = await prisma.profile.update({
      where: { id },
      data: updateData
    })
    res.json(sanitizeProfile(profile))
  } catch {
    res.status(404).json({ error: 'Profile not found' })
  }
}

export async function deleteProfile(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string
  try {
    await prisma.profile.delete({ where: { id } })
    res.json({ success: true })
  } catch {
    res.status(404).json({ error: 'Profile not found' })
  }
}

export async function duplicateProfile(req: Request, res: Response): Promise<void | Response> {
  const id = req.params.id as string
  const existing = await prisma.profile.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: 'Profile not found' })

  const { id: _id, createdAt: _ca, updatedAt: _ua, lastConnectedAt: _lc, ...data } = existing
  void _id
  void _ca
  void _ua
  void _lc
  data.name = `${data.name} (Copy)`

  const duplicate = await prisma.profile.create({
    data
  })
  res.status(201).json(sanitizeProfile(duplicate))
}

export async function connectProfile(req: Request, res: Response): Promise<void | Response> {
  const id = req.params.id as string
  const profile = await prisma.profile.findUnique({ where: { id } })
  if (!profile) return res.status(404).json({ error: 'Profile not found' })

  try {
    const session = await SSHService.createSession(profile)
    res.json({ sessionId: session.id })
  } catch (error: unknown) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to connect'
    })
  }
}

const ExportedTunnelSchema = z.object({
  type: z.string(),
  localPort: z.number().int().min(1).max(65535),
  remoteHost: z.string().nullable().optional(),
  remotePort: z.number().int().min(1).max(65535).nullable().optional(),
  autoStart: z.boolean().default(false),
  label: z.string().nullable().optional()
})

const ExportedProfileSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  authMethod: z.enum(['password', 'key', 'key+passphrase']),
  group: z.string().nullable().optional(),
  terminalTheme: z.string().optional(),
  fontSize: z.number().int().optional(),
  autoReconnect: z.boolean().optional(),
  linkedKeyName: z.string().optional(),
  tunnels: z.array(ExportedTunnelSchema).default([])
})

const ImportBodySchema = z.object({
  profiles: z.array(ExportedProfileSchema).min(1),
  resolutions: z.record(z.string(), z.enum(['skip', 'rename', 'overwrite'])).optional()
})

export async function exportProfiles(req: Request, res: Response): Promise<void> {
  const ids = req.query.ids ? (req.query.ids as string).split(',').filter(Boolean) : undefined
  const payload = await ProfileService.buildExportPayload(ids)
  res.json(payload)
}

export async function importProfiles(req: Request, res: Response): Promise<void | Response> {
  const result = ImportBodySchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ error: result.error.issues })

  const { profiles, resolutions } = result.data

  if (!resolutions) {
    const conflicts = await ProfileService.checkImportConflicts(profiles as ExportedProfile[])
    if (conflicts.length > 0) {
      return res.json({ status: 'conflicts', conflicts })
    }
    const summary = await ProfileService.applyImport(profiles as ExportedProfile[], {})
    return res.json({ status: 'ok', ...summary })
  }

  const summary = await ProfileService.applyImport(
    profiles as ExportedProfile[],
    resolutions as Record<string, ConflictResolution>
  )
  return res.json({ status: 'ok', ...summary })
}
