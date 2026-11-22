import { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { CryptoService } from '../services/crypto.service'
import { SecretsService, type RekeyResult } from '../services/secrets.service'
import { TokenStore } from '../services/token-store.service'
import { AppLockService } from '../services/app-lock.service'
import { ConfigService } from '../services/config.service'
import { logger } from '../services/logger.service'
import { env } from '../config/env'
import { z } from 'zod'

/** BL-26: minimum length of a new master password. Existing shorter passwords keep working. */
export const MIN_MASTER_PASSWORD_LENGTH = 10
const TOO_SHORT = `Password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters.`

const SetupSchema = z.object({
  password: z.string().min(MIN_MASTER_PASSWORD_LENGTH, TOO_SHORT)
})

const UnlockSchema = z.object({
  password: z.string().optional()
})

function generateJWT(): string {
  // Include a random jti so tokens can be individually revoked on lock (SEC-06)
  const jti = TokenStore.issue()
  return jwt.sign({ session: 'active', jti }, env.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h'
  })
}

/**
 * PBKDF2 input used while app lock is off: the OS-managed storage key passed
 * in by the main process (SEC-05).
 */
function storageSecret(): string {
  return process.env.STORAGE_KEY || 'UNLOCKED_NO_PASSWORD'
}

/** Candidate keys for data written while lock was off, plus the key in memory. */
async function keysReadableWithoutLock(salt: string): Promise<Buffer[]> {
  const keys = [await CryptoService.deriveKey(storageSecret(), salt)]
  const active = CryptoService.getActiveKey()
  if (active && !keys.some((key) => key.equals(active))) keys.push(active)
  return keys
}

export async function getStatus(_req: Request, res: Response): Promise<void> {
  const config = await ConfigService.findConfig()
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

  const existing = await ConfigService.findConfig()
  if (existing) {
    res.status(409).json({ error: 'App already configured.' })
    return
  }

  const salt = CryptoService.generateSalt()
  const hash = await CryptoService.hashPassword(result.data.password)

  await ConfigService.createConfig({
    lockEnabled: true,
    masterPasswordHash: hash,
    encryptionKeySalt: salt
  })

  const key = await CryptoService.deriveKey(result.data.password, salt)
  CryptoService.setActiveKey(key)
  await AppLockService.publishPolicy() // BL-18: lock is on now

  const token = generateJWT()
  res.json({ token })
}

export async function setupSkip(_req: Request, res: Response): Promise<void> {
  const existing = await ConfigService.findConfig()
  if (existing) {
    res.status(409).json({ error: 'App already configured.' })
    return
  }

  const salt = CryptoService.generateSalt()
  await ConfigService.createConfig({ lockEnabled: false, encryptionKeySalt: salt })

  // Use the OS-managed storage key (SEC-05 — never a public constant)
  const key = await CryptoService.deriveKey(storageSecret(), salt)
  CryptoService.setActiveKey(key)
  await AppLockService.publishPolicy() // BL-18

  const token = generateJWT()
  res.json({ token })
}

export async function unlock(req: Request, res: Response): Promise<void> {
  const result = UnlockSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: 'Password format invalid.' })
    return
  }

  const config = await ConfigService.findConfig()
  if (!config) {
    res.status(400).json({ error: 'App not configured.' })
    return
  }

  if (!config.lockEnabled) {
    // If lock is disabled, derive key from the OS-managed storage key (SEC-05)
    const key = await CryptoService.deriveKey(storageSecret(), config.encryptionKeySalt)
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

// BL-26: the length rule applies only to a new password (checked below); an
// existing master password that restores lock may be shorter.
const SetPasswordSchema = z.object({
  password: z.string().min(1, 'Password required.')
})

/**
 * Turns app lock on for an install that runs without it (FR-07.7).
 *
 * Every stored secret is re-encrypted from the storage-key-derived key to the
 * new master-password key in the same transaction that stores the password
 * hash, so nothing has to be re-entered.
 *
 * If a master password is still on record (lock was switched off by the
 * pre-BL-10 Settings toggle, which kept the hash), that password must be
 * given: the request then restores lock with it instead of setting a new one.
 * Changing the master password is FR-07.8 (changeMasterPassword).
 */
export async function setupMasterPassword(req: Request, res: Response): Promise<void> {
  const result = SetPasswordSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message })
    return
  }
  const { password } = result.data

  const config = await ConfigService.findConfig()
  if (!config) {
    res.status(400).json({ error: 'App not configured.' })
    return
  }
  if (config.lockEnabled) {
    res.status(400).json({ error: 'App lock is already on.' })
    return
  }

  const oldKeys = await keysReadableWithoutLock(config.encryptionKeySalt)
  let newKey: Buffer
  let rekey: RekeyResult
  if (config.masterPasswordHash) {
    const valid = await CryptoService.verifyPassword(password, config.masterPasswordHash)
    if (!valid) {
      res
        .status(401)
        .json({ error: 'Enter your existing master password to turn app lock back on.' })
      return
    }
    newKey = await CryptoService.deriveKey(password, config.encryptionKeySalt)
    rekey = await SecretsService.rekey(oldKeys, newKey, { lockEnabled: true })
  } else {
    if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
      res.status(400).json({ error: TOO_SHORT })
      return
    }
    const salt = CryptoService.generateSalt()
    const hash = await CryptoService.hashPassword(password)
    newKey = await CryptoService.deriveKey(password, salt)
    rekey = await SecretsService.rekey(oldKeys, newKey, {
      lockEnabled: true,
      masterPasswordHash: hash,
      encryptionKeySalt: salt
    })
  }

  CryptoService.setActiveKey(newKey)
  await AppLockService.publishPolicy() // BL-18: auto-lock applies from now on
  res.json({ token: generateJWT(), unreadableSecrets: rekey.unreadable })
}

const DisableLockSchema = z.object({
  password: z.string().min(1, 'Password required.')
})

/**
 * Turns app lock off (FR-07.7). Requires the current master password, then
 * re-encrypts every stored secret under a key derived from the OS-managed
 * storage key in the same transaction that clears the password hash.
 */
export async function disableLock(req: Request, res: Response): Promise<void> {
  const result = DisableLockSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message })
    return
  }
  const { password } = result.data

  const config = await ConfigService.findConfig()
  if (!config) {
    res.status(400).json({ error: 'App not configured.' })
    return
  }
  if (!config.lockEnabled || !config.masterPasswordHash) {
    res.status(400).json({ error: 'App lock is already off.' })
    return
  }

  const valid = await CryptoService.verifyPassword(password, config.masterPasswordHash)
  if (!valid) {
    res.status(401).json({ error: 'Incorrect master password.' })
    return
  }

  const oldKeys = [await CryptoService.deriveKey(password, config.encryptionKeySalt)]
  const active = CryptoService.getActiveKey()
  if (active && !oldKeys[0].equals(active)) oldKeys.push(active)

  const salt = CryptoService.generateSalt()
  const newKey = await CryptoService.deriveKey(storageSecret(), salt)
  const rekey = await SecretsService.rekey(oldKeys, newKey, {
    lockEnabled: false,
    masterPasswordHash: null,
    encryptionKeySalt: salt
  })

  CryptoService.setActiveKey(newKey)
  await AppLockService.publishPolicy() // BL-18: no auto-lock without a lock
  res.json({ success: true, unreadableSecrets: rekey.unreadable })
}

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required.'),
  newPassword: z.string().min(MIN_MASTER_PASSWORD_LENGTH, TOO_SHORT)
})

/**
 * Changes the master password (FR-07.8, BL-39). Requires the current one, derives the
 * new key from a new salt and re-encrypts every stored secret in the same transaction
 * that stores the new hash and salt. The key in memory is replaced only after that
 * transaction succeeded, so a failure leaves the old password and key working.
 */
export async function changeMasterPassword(req: Request, res: Response): Promise<void> {
  const result = ChangePasswordSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message })
    return
  }
  const { currentPassword, newPassword } = result.data
  if (newPassword === currentPassword) {
    res.status(400).json({ error: 'The new password must be different from the current one.' })
    return
  }

  const config = await ConfigService.findConfig()
  if (!config) {
    res.status(400).json({ error: 'App not configured.' })
    return
  }
  if (!config.lockEnabled || !config.masterPasswordHash) {
    res.status(400).json({ error: 'App lock is off — set a master password instead.' })
    return
  }

  const valid = await CryptoService.verifyPassword(currentPassword, config.masterPasswordHash)
  if (!valid) {
    res.status(401).json({ error: 'Incorrect current password.' })
    return
  }

  const oldKeys = [await CryptoService.deriveKey(currentPassword, config.encryptionKeySalt)]
  const active = CryptoService.getActiveKey()
  if (active && !oldKeys[0].equals(active)) oldKeys.push(active)

  const salt = CryptoService.generateSalt()
  const hash = await CryptoService.hashPassword(newPassword)
  const newKey = await CryptoService.deriveKey(newPassword, salt)

  try {
    const rekey = await SecretsService.rekey(oldKeys, newKey, {
      masterPasswordHash: hash,
      encryptionKeySalt: salt
    })
    CryptoService.setActiveKey(newKey)
    res.json({ success: true, unreadableSecrets: rekey.unreadable })
  } catch (error: unknown) {
    logger.error('Changing the master password failed: ' + String(error))
    res.status(500).json({ error: 'Could not change the master password. Nothing was changed.' })
  }
}

/**
 * Locks the app (FR-07.5, BL-18): forgets the key, revokes every token
 * (SEC-06), closes open terminals and SFTP progress streams, and tells the
 * main process to close the connection windows.
 */
export async function lock(_req: Request, res: Response): Promise<void> {
  AppLockService.lock()
  res.json({ success: true })
}
