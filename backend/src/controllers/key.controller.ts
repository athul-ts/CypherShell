import { Request, Response } from 'express';
import { z } from 'zod';
import { KeyService } from '../services/key.service';

const exportBundleSchema = z.object({
  passphrase: z.string().min(1, 'Passphrase is required'),
  confirmPassphrase: z.string().min(1, 'Confirm passphrase is required'),
});

const importBundleSchema = z.object({
  bundle: z.object({
    version: z.number(),
    keyName: z.string(),
    keyType: z.string(),
    description: z.string().nullable(),
    publicKey: z.string(),
    encryptedPrivateKey: z.string(),
    iv: z.string(),
    salt: z.string(),
    authTag: z.string(),
  }),
  passphrase: z.string().min(1, 'Passphrase is required'),
  resolution: z.enum(['skip', 'rename', 'overwrite']).nullable().optional(),
});

export async function listKeys(_req: Request, res: Response) {
  try {
    const keys = await KeyService.listKeys();
    res.json(keys);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function generateKey(req: Request, res: Response) {
  try {
    const { name, type, passphrase, description } = req.body;
    const key = await KeyService.generateKey(name, type, passphrase, description);
    res.json({ success: true, id: key.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function importKey(req: Request, res: Response) {
  try {
    const { name, privateKey, passphrase, description } = req.body;
    const key = await KeyService.importKey(name, privateKey, description, passphrase);
    res.json({ success: true, id: key.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function getKeyUsage(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const profiles = await KeyService.getKeyUsage(id);
    res.json({ profiles });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function deleteKey(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    await KeyService.deleteKey(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function exportKeyBundle(req: Request, res: Response) {
  try {
    const parsed = exportBundleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { passphrase, confirmPassphrase } = parsed.data;
    if (passphrase !== confirmPassphrase) {
      res.status(400).json({ error: 'Passphrases do not match' });
      return;
    }
    const id = req.params.id as string;
    const bundle = await KeyService.buildKeyBundle(id, passphrase);
    res.json(bundle);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function importKeyBundle(req: Request, res: Response) {
  try {
    const parsed = importBundleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { bundle, passphrase, resolution } = parsed.data;
    const result = await KeyService.applyKeyImport(bundle, passphrase, resolution ?? null);
    if (result.status === 'conflict') {
      res.status(409).json({ status: 'conflict', conflictName: result.conflictName, profileCount: result.profileCount ?? 0 });
      return;
    }
    res.json({ status: result.status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}
