import { Request, Response } from 'express'
import { z } from 'zod'
import { KeyService } from '../services/key.service'

const generateKeySchema = z
  .object({
    name: z.string().trim().min(1, 'Key name is required'),
    type: z.enum(['rsa', 'ed25519']),
    bits: z.union([z.literal(2048), z.literal(4096)]).optional(),
    passphrase: z.string().optional(),
    description: z.string().optional()
  })
  .refine((data) => data.type === 'rsa' || data.bits === undefined, {
    message: 'Key size applies to RSA keys only'
  })

const importKeySchema = z.object({
  name: z.string().trim().min(1, 'Key name is required'),
  privateKey: z.string().min(1, 'Private key is required'),
  passphrase: z.string().optional(),
  description: z.string().optional()
})

const exportBundleSchema = z.object({
  passphrase: z.string().min(1, 'Passphrase is required'),
  confirmPassphrase: z.string().min(1, 'Confirm passphrase is required')
})

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
    authTag: z.string()
  }),
  passphrase: z.string().min(1, 'Passphrase is required'),
  resolution: z.enum(['skip', 'rename', 'overwrite']).nullable().optional()
})

export async function listKeys(_req: Request, res: Response): Promise<void> {
  try {
    const keys = await KeyService.listKeys()
    res.json(keys)
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function generateKey(req: Request, res: Response): Promise<void> {
  const parsed = generateKeySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message })
    return
  }
  try {
    const { name, type, bits, passphrase, description } = parsed.data
    const key = await KeyService.generateKey(name, type, passphrase || undefined, description, bits)
    res.json({ success: true, id: key.id })
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function importKey(req: Request, res: Response): Promise<void> {
  const parsed = importKeySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message })
    return
  }
  try {
    const { name, privateKey, passphrase, description } = parsed.data
    const key = await KeyService.importKey(name, privateKey, description, passphrase || undefined)
    res.json({ success: true, id: key.id })
  } catch (error: unknown) {
    // An unparseable key or a wrong passphrase is a client error (FUN-07).
    const message = error instanceof Error ? error.message : String(error)
    res.status(/^Invalid private key|^Unsupported private key/.test(message) ? 400 : 500).json({
      error: message
    })
  }
}

export async function getKeyUsage(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string
    const profiles = await KeyService.getKeyUsage(id)
    res.json({ profiles })
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function deleteKey(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string
    await KeyService.deleteKey(id)
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function exportKeyBundle(req: Request, res: Response): Promise<void> {
  try {
    const parsed = exportBundleSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message })
      return
    }
    const { passphrase, confirmPassphrase } = parsed.data
    if (passphrase !== confirmPassphrase) {
      res.status(400).json({ error: 'Passphrases do not match' })
      return
    }
    const id = req.params.id as string
    const bundle = await KeyService.buildKeyBundle(id, passphrase)
    res.json(bundle)
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function importKeyBundle(req: Request, res: Response): Promise<void> {
  try {
    const parsed = importBundleSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message })
      return
    }
    const { bundle, passphrase, resolution } = parsed.data
    const result = await KeyService.applyKeyImport(bundle, passphrase, resolution ?? null)
    if (result.status === 'conflict') {
      res.status(409).json({
        status: 'conflict',
        conflictName: result.conflictName,
        profileCount: result.profileCount ?? 0
      })
      return
    }
    res.json({ status: result.status })
  } catch (error: unknown) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
}
