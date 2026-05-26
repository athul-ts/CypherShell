import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { CryptoService } from '../services/crypto.service';
import { SSHService } from '../services/ssh.service';
import { z } from 'zod';

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
  autoReconnect: z.boolean().default(true),
});

function sanitizeProfile(profile: any) {
  const { encryptedPassword, ...rest } = profile;
  return { ...rest, hasPassword: !!encryptedPassword };
}

export async function listProfiles(req: Request, res: Response) {
  const profiles = await prisma.profile.findMany({
    orderBy: { name: 'asc' },
  });
  res.json(profiles.map(sanitizeProfile));
}

export async function getProfile(req: Request, res: Response) {
  const id = req.params.id as string;
  const profile = await prisma.profile.findUnique({
    where: { id },
    include: { tunnels: true },
  });
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  res.json(sanitizeProfile(profile));
}

export async function createProfile(req: Request, res: Response) {
  const result = ProfileSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues });

  const { password, ...data } = result.data;
  const encryptedPassword = password ? CryptoService.encrypt(password) : null;
  const sshKeyId = (data.authMethod === 'password' || !data.sshKeyId) ? null : data.sshKeyId;

  const profile = await prisma.profile.create({
    data: {
      ...data,
      sshKeyId,
      encryptedPassword,
    },
  });
  res.status(201).json(sanitizeProfile(profile));
}

export async function updateProfile(req: Request, res: Response) {
  const id = req.params.id as string;
  const result = ProfileSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues });

  const { password, ...data } = result.data;
  
  // Only update encryptedPassword if a new one is provided.
  // Otherwise, leave the existing one.
  const updateData: any = { 
    ...data,
    sshKeyId: (data.authMethod === 'password' || !data.sshKeyId) ? null : data.sshKeyId,
  };
  if (password !== undefined) {
    if (password === '') {
      updateData.encryptedPassword = null;
    } else {
      updateData.encryptedPassword = CryptoService.encrypt(password);
    }
  }

  try {
    const profile = await prisma.profile.update({
      where: { id },
      data: updateData,
    });
    res.json(sanitizeProfile(profile));
  } catch (error) {
    res.status(404).json({ error: 'Profile not found' });
  }
}

export async function deleteProfile(req: Request, res: Response) {
  const id = req.params.id as string;
  try {
    await prisma.profile.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(404).json({ error: 'Profile not found' });
  }
}

export async function duplicateProfile(req: Request, res: Response) {
  const id = req.params.id as string;
  const existing = await prisma.profile.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Profile not found' });

  const { id: _id, createdAt: _ca, updatedAt: _ua, lastConnectedAt: _lc, ...data } = existing;
  data.name = `${data.name} (Copy)`;

  const duplicate = await prisma.profile.create({
    data,
  });
  res.status(201).json(sanitizeProfile(duplicate));
}

export async function connectProfile(req: Request, res: Response) {
  const id = req.params.id as string;
  const profile = await prisma.profile.findUnique({ where: { id } });
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  
  try {
    const session = await SSHService.createSession(profile);
    res.json({ sessionId: session.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to connect' });
  }
}
