import { Request, Response } from 'express'
import { AppNotConfiguredError, ConfigService } from '../services/config.service'

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
  try {
    const config = await ConfigService.updateConfig(req.body)
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
