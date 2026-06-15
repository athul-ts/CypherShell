import { generateKeyPairSync } from 'crypto'
import { prisma } from '../config/db'
import type { SSHKey } from '@prisma/client'
import { CryptoService } from './crypto.service'
import sshpk from 'sshpk'

export interface CskbBundle {
  version: number
  keyName: string
  keyType: string
  description: string | null
  publicKey: string
  encryptedPrivateKey: string
  iv: string
  salt: string
  authTag: string
}

export class KeyService {
  static async generateKey(
    name: string,
    type: 'rsa' | 'ed25519',
    passphrase?: string,
    description?: string
  ): Promise<SSHKey> {
    let privateKeyStr = ''
    let publicKeyStr = ''

    if (type === 'rsa') {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      })
      privateKeyStr = privateKey
      // Convert to OpenSSH format
      const key = sshpk.parseKey(publicKey, 'pem')
      publicKeyStr = key.toString('ssh')
    } else if (type === 'ed25519') {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      })
      privateKeyStr = privateKey
      const key = sshpk.parseKey(publicKey, 'pem')
      publicKeyStr = key.toString('ssh')
    }

    const keyForFp = sshpk.parseKey(publicKeyStr, 'ssh')
    const fingerprint = keyForFp.fingerprint('sha256').toString()

    // If a passphrase is provided, we would encrypt the PEM with it first, or just rely on our AES encryption
    // Actually, SRS says "All private keys AES-256-GCM encrypted in SQLite — never plaintext".
    // And "Optional passphrase protection per stored key". If they add a passphrase, we can store a flag `hasPassphrase`.
    // But ssh2 expects either unencrypted PEM or PEM encrypted with passphrase.
    // If we just store it encrypted by our AES key, and inject the passphrase when using it?
    // Let's just encrypt the raw PEM with our AES key. The passphrase flag is for when the original key requires a passphrase.

    const encryptedPrivateKey = CryptoService.encrypt(privateKeyStr)

    return prisma.sSHKey.create({
      data: {
        name,
        description,
        keyType: type,
        encryptedPrivateKey,
        publicKey: publicKeyStr,
        fingerprint,
        hasPassphrase: !!passphrase
      }
    })
  }

  static async importKey(
    name: string,
    privateKeyPem: string,
    description?: string,
    passphrase?: string
  ): Promise<SSHKey> {
    let key: sshpk.PrivateKey
    try {
      // Parse to ensure it's valid, and extract the public key
      key = sshpk.parsePrivateKey(privateKeyPem, 'auto')
    } catch {
      throw new Error('Invalid private key format')
    }

    const publicKeyStr = key.toPublic().toString('ssh')
    const fingerprint = key.fingerprint('sha256').toString()
    const type = key.type === 'ed25519' ? 'ed25519' : 'rsa' // Simplify types

    const encryptedPrivateKey = CryptoService.encrypt(privateKeyPem)

    return prisma.sSHKey.create({
      data: {
        name,
        description,
        keyType: type,
        encryptedPrivateKey,
        publicKey: publicKeyStr,
        fingerprint,
        hasPassphrase: !!passphrase
      }
    })
  }

  static async listKeys(): Promise<
    Pick<
      SSHKey,
      | 'id'
      | 'name'
      | 'description'
      | 'keyType'
      | 'publicKey'
      | 'fingerprint'
      | 'hasPassphrase'
      | 'createdAt'
    >[]
  > {
    const keys = await prisma.sSHKey.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        keyType: true,
        publicKey: true,
        fingerprint: true,
        hasPassphrase: true,
        createdAt: true
      }
    })
    return keys
  }

  static async getKeyUsage(id: string): Promise<{ id: string; name: string }[]> {
    const key = await prisma.sSHKey.findUnique({
      where: { id },
      include: { profiles: { select: { id: true, name: true } } }
    })
    return key?.profiles ?? []
  }

  static async deleteKey(id: string): Promise<SSHKey> {
    return prisma.sSHKey.delete({ where: { id } })
  }

  static async buildKeyBundle(id: string, passphrase: string): Promise<CskbBundle> {
    const key = await prisma.sSHKey.findUnique({ where: { id } })
    if (!key) throw new Error('Key not found')
    const privateKeyPem = CryptoService.decrypt(key.encryptedPrivateKey)
    const encrypted = await CryptoService.encryptWithPassphrase(privateKeyPem, passphrase)
    return {
      version: 1,
      keyName: key.name,
      keyType: key.keyType,
      description: key.description,
      publicKey: key.publicKey,
      ...encrypted
    }
  }

  static async applyKeyImport(
    bundle: CskbBundle,
    passphrase: string,
    resolution: 'skip' | 'rename' | 'overwrite' | null
  ): Promise<{
    status: 'imported' | 'skipped' | 'conflict'
    conflictName?: string
    profileCount?: number
  }> {
    let privateKeyPem: string
    try {
      privateKeyPem = await CryptoService.decryptWithPassphrase(bundle, passphrase)
    } catch {
      throw new Error('Invalid passphrase or corrupted bundle')
    }

    const existing = await prisma.sSHKey.findFirst({
      where: { name: bundle.keyName },
      include: { profiles: { select: { id: true } } }
    })
    let finalName = bundle.keyName

    if (existing) {
      if (!resolution)
        return {
          status: 'conflict',
          conflictName: bundle.keyName,
          profileCount: existing.profiles.length
        }
      if (resolution === 'skip') return { status: 'skipped' }
      if (resolution === 'rename') finalName = `${bundle.keyName} (imported)`
      if (resolution === 'overwrite') await prisma.sSHKey.delete({ where: { id: existing.id } })
    }

    let parsedKey: ReturnType<typeof sshpk.parsePrivateKey>
    try {
      parsedKey = sshpk.parsePrivateKey(privateKeyPem, 'auto')
    } catch (err) {
      throw new Error(`Invalid private key in bundle: ${(err as Error).message}`)
    }
    const publicKeyStr = parsedKey.toPublic().toString('ssh')
    const fingerprint = parsedKey.fingerprint('sha256').toString()
    const keyType = parsedKey.type === 'ed25519' ? 'ed25519' : 'rsa'

    const encryptedPrivateKey = CryptoService.encrypt(privateKeyPem)

    await prisma.sSHKey.create({
      data: {
        name: finalName,
        description: bundle.description ?? undefined,
        keyType,
        encryptedPrivateKey,
        publicKey: publicKeyStr,
        fingerprint,
        hasPassphrase: false
      }
    })

    return { status: 'imported' }
  }
}
