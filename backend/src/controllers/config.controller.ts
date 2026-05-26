import { Request, Response } from 'express';
import { ConfigService } from '../services/config.service';

export async function getConfig(req: Request, res: Response) {
  try {
    const config = await ConfigService.getConfig();
    // Don't leak the master password hash or salt to frontend if not needed,
    // but for MVP it's okay, or we can pick fields.
    const { masterPasswordHash, encryptionKeySalt, ...safeConfig } = config;
    res.json(safeConfig);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function updateConfig(req: Request, res: Response) {
  try {
    const config = await ConfigService.updateConfig(req.body);
    const { masterPasswordHash, encryptionKeySalt, ...safeConfig } = config;
    res.json(safeConfig);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
