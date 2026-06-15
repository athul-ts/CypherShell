import { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../config/db'
import { CryptoService } from '../services/crypto.service'
import { env } from '../config/env'
import { z } from 'zod'

const SetupSchema = z.object({
  password: z.string().min(6)
})

const UnlockSchema = z.object({
  password: z.string().optional()
})

function generateJWT(): string {
  return jwt.sign({ session: 'active' }, env.jwtSecret, { expiresIn: '8h' })
}

export async function getStatus(_req: Request, res: Response): Promise<void> {
  const config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } })
  if (!config) {
    res.json({ configured: false, locked: false })
    return
  }
  res.json({ configured: true, locked: config.lockEnabled })
}

export async function setup(req: Request, res: Response): Promise<void> {
  const result = SetupSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message })
    return
  }

  const existing = await prisma.appConfig.findUnique({ where: { id: 'singleton' } })
  if (existing) {
    res.status(409).json({ error: 'App already configured.' })
    return
  }

  const salt = CryptoService.generateSalt()
  const hash = await CryptoService.hashPassword(result.data.password)

  await prisma.appConfig.create({
    data: {
      id: 'singleton',
      lockEnabled: true,
      masterPasswordHash: hash,
      encryptionKeySalt: salt
    }
  })

  const key = await CryptoService.deriveKey(result.data.password, salt)
  CryptoService.setActiveKey(key)

  const token = generateJWT()
  res.json({ token })
}

export async function setupSkip(_req: Request, res: Response): Promise<void> {
  const existing = await prisma.appConfig.findUnique({ where: { id: 'singleton' } })
  if (existing) {
    res.status(409).json({ error: 'App already configured.' })
    return
  }

  const salt = CryptoService.generateSalt()
  await prisma.appConfig.create({
    data: {
      id: 'singleton',
      lockEnabled: false,
      encryptionKeySalt: salt
    }
  })

  // Use a hardcoded dummy password since lock is disabled
  const key = await CryptoService.deriveKey('UNLOCKED_NO_PASSWORD', salt)
  CryptoService.setActiveKey(key)

  const token = generateJWT()
  res.json({ token })
}

export async function unlock(req: Request, res: Response): Promise<void> {
  const result = UnlockSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: 'Password format invalid.' })
    return
  }

  const config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } })
  if (!config) {
    res.status(400).json({ error: 'App not configured.' })
    return
  }

  if (!config.lockEnabled) {
    // If lock is disabled, we just use the dummy key
    const key = await CryptoService.deriveKey('UNLOCKED_NO_PASSWORD', config.encryptionKeySalt)
    CryptoService.setActiveKey(key)
    res.json({ token: generateJWT() })
    return
  }

  if (!config.masterPasswordHash) {
    res.status(400).json({ error: 'Master password missing but lock is enabled.' })
    return
  }

  if (!result.data.password) {
    res.status(401).json({ error: 'Password required.' })
    return
  }

  const valid = await CryptoService.verifyPassword(result.data.password, config.masterPasswordHash)
  if (!valid) {
    res.status(401).json({ error: 'Invalid password.' })
    return
  }

  const key = await CryptoService.deriveKey(result.data.password, config.encryptionKeySalt)
  CryptoService.setActiveKey(key)

  const token = generateJWT()
  res.json({ token })
}

export async function lock(_req: Request, res: Response): Promise<void> {
  CryptoService.clearActiveKey()
  // Client should clear its JWT token; server is stateless
  res.json({ success: true })
}
