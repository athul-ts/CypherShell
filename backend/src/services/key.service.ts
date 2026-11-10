import { utils as ssh2Utils } from 'ssh2'
import { prisma } from '../config/db'
import type { SSHKey } from '@prisma/client'
import { CryptoService } from './crypto.service'
import { logger } from './logger.service'
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

export type GeneratedKeyType = 'rsa' | 'ed25519'
export type RsaBits = 2048 | 4096

/** Cipher and bcrypt-KDF rounds used when a generated key gets its own passphrase (ssh-keygen defaults). */
const GENERATED_KEY_CIPHER = 'aes256-ctr'
const GENERATED_KEY_KDF_ROUNDS = 16

/** Whether the bundled ssh2 client can use this private key as-is (with its passphrase). */
function ssh2CanParse(privateKey: string, passphrase?: string): boolean {
  return !(ssh2Utils.parseKey(privateKey, passphrase) instanceof Error)
}

/** True when ssh2 recognises the key but needs a passphrase to open it. */
function isPassphraseProtected(privateKey: string): boolean {
  const result = ssh2Utils.parseKey(privateKey)
  return result instanceof Error && /no passphrase given/i.test(result.message)
}

interface PreparedPrivateKey {
  /** The private key to store: ssh2-readable, possibly passphrase-protected. */
  privateKey: string
  hasPassphrase: boolean
  publicKey: string
  fingerprint: string
  keyType: string
}

/**
 * Turns a user-supplied private key into one the bundled ssh2 client can
 * use (BL-12). ssh2 1.17 reads only OpenSSH, PKCS#1/SEC1 PEM and PPK v2
 * RSA/DSS keys, so anything else (PKCS#8, PPK v3, ED25519 PPK, …) is
 * converted to OpenSSH with sshpk. Conversion needs the decrypted key, so a
 * converted key is stored without its passphrase — it stays AES-256-GCM
 * encrypted at rest like every other secret.
 */
function preparePrivateKey(privateKey: string, passphrase?: string): PreparedPrivateKey {
  const pass = passphrase || undefined
  let parsed: sshpk.PrivateKey
  try {
    parsed = sshpk.parsePrivateKey(privateKey, 'auto', pass ? { passphrase: pass } : undefined)
  } catch {
    throw new Error(
      pass
        ? 'Invalid private key or incorrect passphrase'
        : 'Invalid private key format (key may be passphrase-protected)'
    )
  }

  const publicKey = parsed.toPublic().toString('ssh')
  const fingerprint = parsed.fingerprint('sha256').toString()
  const keyType = parsed.type

  if (ssh2CanParse(privateKey)) {
    return { privateKey, hasPassphrase: false, publicKey, fingerprint, keyType }
  }
  if (pass && ssh2CanParse(privateKey, pass)) {
    return { privateKey, hasPassphrase: true, publicKey, fingerprint, keyType }
  }

  const converted = parsed.toString('openssh')
  if (!ssh2CanParse(converted)) {
    throw new Error(`Unsupported private key type for SSH connections: ${keyType}`)
  }
  return { privateKey: converted, hasPassphrase: false, publicKey, fingerprint, keyType }
}

export class KeyService {
  static async generateKey(
    name: string,
    type: GeneratedKeyType,
    passphrase?: string,
    description?: string,
    bits: RsaBits = 2048
  ): Promise<SSHKey> {
    // ssh2 generates OpenSSH-format keys, the format its own client always
    // reads; the previous PKCS#8 output could not authenticate at all (BL-12).
    const encryption = passphrase
      ? { passphrase, cipher: GENERATED_KEY_CIPHER, rounds: GENERATED_KEY_KDF_ROUNDS }
      : {}
    const pair =
      type === 'rsa'
        ? ssh2Utils.generateKeyPairSync('rsa', { bits, comment: name, ...encryption })
        : ssh2Utils.generateKeyPairSync('ed25519', { comment: name, ...encryption })

    const fingerprint = sshpk.parseKey(pair.public, 'ssh').fingerprint('sha256').toString()

    return prisma.sSHKey.create({
      data: {
        name,
        description,
        keyType: type,
        encryptedPrivateKey: CryptoService.encrypt(pair.private),
        publicKey: pair.public,
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
    const prepared = preparePrivateKey(privateKeyPem, passphrase)

    return prisma.sSHKey.create({
      data: {
        name,
        description,
        keyType: prepared.keyType,
        encryptedPrivateKey: CryptoService.encrypt(prepared.privateKey),
        publicKey: prepared.publicKey,
        fingerprint: prepared.fingerprint,
        hasPassphrase: prepared.hasPassphrase
      }
    })
  }

  /**
   * Returns a private key ssh2 can parse for this stored key. Keys saved
   * before BL-12 (PKCS#8 from the old generator, or imports stored
   * unconverted) are converted to OpenSSH once and saved back.
   */
  static async ensureUsablePrivateKey(
    keyId: string,
    privateKey: string,
    passphrase?: string
  ): Promise<string> {
    if (ssh2CanParse(privateKey, passphrase || undefined)) return privateKey

    let prepared: PreparedPrivateKey
    try {
      prepared = preparePrivateKey(privateKey, passphrase)
    } catch {
      return privateKey // let ssh2 report the original problem
    }
    await prisma.sSHKey.update({
      where: { id: keyId },
      data: {
        encryptedPrivateKey: CryptoService.encrypt(prepared.privateKey),
        hasPassphrase: prepared.hasPassphrase
      }
    })
    logger.info(`Converted stored SSH key ${keyId} to OpenSSH format`)
    return prepared.privateKey
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

    // A key that carries its own passphrase cannot be parsed without it, so
    // its public half and fingerprint come from the bundle (BL-12).
    const hasPassphrase = isPassphraseProtected(privateKeyPem)
    let publicKeyStr: string
    let fingerprint: string
    let keyType: string
    try {
      const parsed = hasPassphrase
        ? sshpk.parseKey(bundle.publicKey, 'ssh')
        : sshpk.parsePrivateKey(privateKeyPem, 'auto').toPublic()
      publicKeyStr = parsed.toString('ssh')
      fingerprint = parsed.fingerprint('sha256').toString()
      keyType = parsed.type
    } catch (err) {
      throw new Error(`Invalid private key in bundle: ${(err as Error).message}`)
    }

    const usableKey = hasPassphrase ? privateKeyPem : preparePrivateKey(privateKeyPem).privateKey

    await prisma.sSHKey.create({
      data: {
        name: finalName,
        description: bundle.description ?? undefined,
        keyType,
        encryptedPrivateKey: CryptoService.encrypt(usableKey),
        publicKey: publicKeyStr,
        fingerprint,
        hasPassphrase
      }
    })

    return { status: 'imported' }
  }
}
