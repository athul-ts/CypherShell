import { Request, Response } from 'express'
import { z } from 'zod'
import { AppNotConfiguredError, ConfigService } from '../services/config.service'
import { AppLockService } from '../services/app-lock.service'

/**
 * BL-23: the settings `PUT /api/config` may change. Unknown keys — notably
 * `lockEnabled`, which only the auth endpoints change (FR-07.7) — are
 * stripped, as before.
 */
const ConfigUpdateSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  defaultFont: z.string().trim().min(1).max(200).optional(),
  defaultFontSize: z.number().int().min(8).max(72).optional(),
  logRetentionDays: z.number().int().min(0).max(3650).optional(),
  autoLockMinutes: z.number().int().min(1).max(1440).optional()
})

function sendError(res: Response, error: unknown): void {
  if (error instanceof AppNotConfiguredError) {
    res.status(409).json({ error: error.message })
    return
  }
  res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
}

export async function getConfig(_req: Request, res: Response): Promise<void> {
  try {
    const config = await ConfigService.getConfig()
    // Don't leak the master password hash or salt to frontend.
    res.json(stripSecrets(config))
  } catch (error: unknown) {
    sendError(res, error)
  }
}

export async function updateConfig(req: Request, res: Response): Promise<void> {
  const body = ConfigUpdateSchema.safeParse(req.body)
  if (!body.success) {
    const issue = body.error.issues[0]
    res
      .status(400)
      .json({ error: `Invalid ${issue?.path.join('.') || 'settings'}: ${issue?.message}` })
    return
  }
  try {
    const config = await ConfigService.updateConfig(body.data)
    await AppLockService.publishPolicy() // BL-18: the idle timeout may have changed
    res.json(stripSecrets(config))
  } catch (error: unknown) {
    sendError(res, error)
  }
}

/**
 * Removes the password hash and key salt, and adds `hasMasterPassword` so the
 * renderer can tell a never-protected install from one whose lock was turned off.
 */
function stripSecrets<T extends { masterPasswordHash?: unknown; encryptionKeySalt?: unknown }>(
  config: T
): Omit<T, 'masterPasswordHash' | 'encryptionKeySalt'> & { hasMasterPassword: boolean } {
  const safeConfig = { ...config, hasMasterPassword: !!config.masterPasswordHash }
  delete safeConfig.masterPasswordHash
  delete safeConfig.encryptionKeySalt
  return safeConfig
}
