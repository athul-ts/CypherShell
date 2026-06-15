import { Request, Response } from 'express'
import { ConfigService } from '../services/config.service'

export async function getConfig(req: Request, res: Response): Promise<void> {
  try {
    const config = await ConfigService.getConfig()
    // Don't leak the master password hash or salt to frontend.
    const safeConfig = stripSecrets(config)
    res.json(safeConfig)
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

export async function updateConfig(req: Request, res: Response): Promise<void> {
  try {
    const config = await ConfigService.updateConfig(req.body)
    const safeConfig = stripSecrets(config)
    res.json(safeConfig)
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

function stripSecrets<T extends { masterPasswordHash?: unknown; encryptionKeySalt?: unknown }>(
  config: T
): Omit<T, 'masterPasswordHash' | 'encryptionKeySalt'> {
  const safeConfig = { ...config }
  delete safeConfig.masterPasswordHash
  delete safeConfig.encryptionKeySalt
  return safeConfig
}
