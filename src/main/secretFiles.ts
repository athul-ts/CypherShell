/**
 * Secret files under `{userData}/secrets` (BL-19).
 *
 * The directory is owner-only (0700) and every file in it owner-readable only
 * (0600). Files and folders created by older versions with the default
 * 0755/0644 are tightened at startup. Windows ignores POSIX modes; there the
 * per-user profile ACLs protect userData.
 *
 * Deliberately free of Electron imports (safeStorage is passed in as a codec)
 * so it can be unit-tested.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const DIR_MODE = 0o700
const FILE_MODE = 0o600

/** Creates the secrets directory owner-only, and tightens an existing one. */
export function ensureSecretsDir(dir: string, platform: NodeJS.Platform = process.platform): void {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE })
  if (platform !== 'win32') chmodSync(dir, DIR_MODE)
}

/** Writes a secret file readable by its owner only. */
export function writeSecretFile(
  filePath: string,
  data: string | Buffer,
  platform: NodeJS.Platform = process.platform
): void {
  writeFileSync(filePath, data, { mode: FILE_MODE })
  // `mode` applies only when the file is created; an existing file keeps its mode.
  if (platform !== 'win32') chmodSync(filePath, FILE_MODE)
}

/**
 * Deletes the JWT secret file older versions kept. Since BL-19 the backend
 * holds its signing secret in memory only. Returns true when a file was removed.
 */
export function removeLegacyJwtSecret(dir: string): boolean {
  const legacy = join(dir, 'jwt-secret')
  if (!existsSync(legacy)) return false
  rmSync(legacy, { force: true })
  return true
}

/**
 * How the storage key is protected at rest — Electron `safeStorage` when available.
 * The methods are asynchronous because Electron 46 removes the synchronous API (BL-36).
 */
export interface StorageKeyCodec {
  available: boolean
  encrypt: (plain: string) => Promise<Buffer>
  /** `reEncrypt`: the keychain asks for the value to be written again (`shouldReEncrypt`). */
  decrypt: (encrypted: Buffer) => Promise<{ plain: string; reEncrypt?: boolean }>
}

/**
 * Loads the per-install storage key (SEC-05), creating it on first launch.
 * With an OS keychain the file holds the key encrypted, otherwise in
 * plaintext — owner-only either way.
 */
export async function loadOrCreateStorageKey(
  dir: string,
  codec: StorageKeyCodec,
  generate: () => string,
  platform: NodeJS.Platform = process.platform
): Promise<{ key: string; created: boolean }> {
  ensureSecretsDir(dir, platform)
  const filePath = join(dir, 'storage-key')
  try {
    const stored = readFileSync(filePath)
    let key: string
    if (codec.available) {
      const decrypted = await codec.decrypt(stored)
      key = decrypted.plain
      if (decrypted.reEncrypt) writeSecretFile(filePath, await codec.encrypt(key), platform)
    } else {
      key = stored.toString('utf8').trim()
    }
    if (platform !== 'win32') chmodSync(filePath, FILE_MODE)
    return { key, created: false }
  } catch {
    const key = generate()
    writeSecretFile(filePath, codec.available ? await codec.encrypt(key) : key, platform)
    return { key, created: true }
  }
}
