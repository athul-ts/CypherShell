import { Request, Response } from 'express'
import type { Prisma, Profile, Tunnel } from '@prisma/client'
import { CryptoService } from '../services/crypto.service'
import { SSHService } from '../services/ssh.service'
import { HostKeyError } from '../services/known-host.service'
import { ProfileService } from '../services/profile.service'
import { logger } from '../services/logger.service'
import type { ExportedProfile, ConflictResolution } from '../services/profile.service'
import { z } from 'zod'

type ProfileWithRelations = Profile & { tunnels?: Tunnel[] }
type SanitizedProfile = Omit<ProfileWithRelations, 'encryptedPassword'> & { hasPassword: boolean }

/**
 * Field rules with no defaults attached. Create and update both derive from
 * this so the two payloads can never drift apart.
 */
const ProfileFieldsSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  authMethod: z.enum(['password', 'key', 'key+passphrase']),
  password: z.string().optional(),
  sshKeyId: z.string().optional(),
  group: z.string().nullable().optional(),
  terminalTheme: z.string(),
  fontSize: z.number().int(),
  autoReconnect: z.boolean()
})

/** Create: POST /api/profiles — full payload, sensible defaults. */
const ProfileSchema = ProfileFieldsSchema.extend({
  port: ProfileFieldsSchema.shape.port.default(22),
  terminalTheme: ProfileFieldsSchema.shape.terminalTheme.default('dark'),
  fontSize: ProfileFieldsSchema.shape.fontSize.default(14),
  autoReconnect: ProfileFieldsSchema.shape.autoReconnect.default(true)
})

/**
 * Update: PUT /api/profiles/:id takes a partial payload — FR-01.8.4 has the
 * form send only the changed fields.
 *
 * Derived from the default-free base on purpose: `.partial()` over a
 * `.default()` field still injects that default when the key is absent, so a
 * name-only save would silently reset port/theme/fontSize/autoReconnect.
 */
const ProfileUpdateSchema = ProfileFieldsSchema.partial()

function sanitizeProfile(profile: ProfileWithRelations): SanitizedProfile {
  const { encryptedPassword, ...rest } = profile
  return { ...rest, hasPassword: !!encryptedPassword }
}

export async function listProfiles(_req: Request, res: Response): Promise<void> {
  const profiles = await ProfileService.list()
  res.json(profiles.map(sanitizeProfile))
}

export async function getProfile(req: Request, res: Response): Promise<void | Response> {
  const id = req.params.id as string
  const profile = await ProfileService.get(id)
  if (!profile) return res.status(404).json({ error: 'Profile not found' })
  res.json(sanitizeProfile(profile))
}

export async function createProfile(req: Request, res: Response): Promise<void | Response> {
  const result = ProfileSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ error: result.error.issues })

  const { password, ...data } = result.data
  const encryptedPassword = password ? CryptoService.encrypt(password) : null
  const sshKeyId = data.authMethod === 'password' || !data.sshKeyId ? null : data.sshKeyId

  const profile = await ProfileService.create({ ...data, sshKeyId, encryptedPassword })
  res.status(201).json(sanitizeProfile(profile))
}

export async function updateProfile(req: Request, res: Response): Promise<void | Response> {
  const id = req.params.id as string
  const result = ProfileUpdateSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ error: result.error.issues })

  const { password, sshKeyId, ...data } = result.data

  // Fields the caller omitted stay `undefined`, which Prisma reads as
  // "leave this column alone" — that is what makes a partial save partial.
  // Unchecked (not the `UpdateInput` union): we write the `sshKeyId` scalar
  // directly and never the `sshKey` relation form.
  const updateData: Prisma.ProfileUncheckedUpdateInput = { ...data }

  // FR-01.8.6: switching to password auth drops any linked key, and an
  // explicitly supplied key id replaces the stored one. Omitting both leaves
  // the existing link untouched.
  if (data.authMethod === 'password') {
    updateData.sshKeyId = null
  } else if (sshKeyId !== undefined) {
    updateData.sshKeyId = sshKeyId || null
  }

  // Only update encryptedPassword if a new one is provided.
  // Otherwise, leave the existing one.
  if (password !== undefined) {
    if (password === '') {
      updateData.encryptedPassword = null
    } else {
      updateData.encryptedPassword = CryptoService.encrypt(password)
    }
  }

  const profile = await ProfileService.update(id, updateData)
  if (!profile) return res.status(404).json({ error: 'Profile not found' })
  res.json(sanitizeProfile(profile))
}

export async function deleteProfile(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string
  if (await ProfileService.remove(id)) res.json({ success: true })
  else res.status(404).json({ error: 'Profile not found' })
}

export async function duplicateProfile(req: Request, res: Response): Promise<void | Response> {
  const id = req.params.id as string
  const duplicate = await ProfileService.duplicate(id)
  if (!duplicate) return res.status(404).json({ error: 'Profile not found' })
  res.status(201).json(sanitizeProfile(duplicate))
}

/** BL-38: the fingerprint the user confirmed for a host key that was not trusted yet. */
const ConnectBodySchema = z.object({
  acceptHostKey: z
    .string()
    .regex(/^SHA256:[A-Za-z0-9+/]{43}$/, 'acceptHostKey must be a SHA256 fingerprint')
    .optional()
})

export async function connectProfile(req: Request, res: Response): Promise<void | Response> {
  const id = req.params.id as string
  const body = ConnectBodySchema.safeParse(req.body ?? {})
  if (!body.success) {
    return res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid request' })
  }
  const profile = await ProfileService.findForConnect(id)
  if (!profile) return res.status(404).json({ error: 'Profile not found' })

  try {
    const session = await SSHService.createSession(profile, {
      acceptHostKey: body.data.acceptHostKey
    })
    // A failure to record the time must not fail a connection that succeeded.
    await ProfileService.markConnected(profile.id).catch((err) =>
      logger.error('Could not record lastConnectedAt: ' + String(err))
    )
    res.json({ sessionId: session.id })
  } catch (error: unknown) {
    if (error instanceof HostKeyError) {
      return res.status(409).json({ code: error.code, ...error.details, error: error.message })
    }
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
