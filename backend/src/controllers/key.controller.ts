import { Request, Response } from 'express';
import { KeyService } from '../services/key.service';

export async function listKeys(req: Request, res: Response) {
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

export async function deleteKey(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    await KeyService.deleteKey(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
