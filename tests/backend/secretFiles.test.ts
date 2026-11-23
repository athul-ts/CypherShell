/**
 * [NFR-02][BL-19] Secret files are owner-only, and the JWT secret no longer
 * lives on disk.
 *
 * Regression: `secrets/jwt-secret` and the plaintext storage-key fallback
 * were written 0644 in a 0755 directory — readable by other local users.
 *
 * The POSIX permission checks are skipped on Windows, which ignores file
 * modes (per-user profile ACLs protect userData there); CI runs them on Linux.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  ensureSecretsDir,
  loadOrCreateStorageKey,
  removeLegacyJwtSecret,
  writeSecretFile,
  type StorageKeyCodec
} from '../../src/main/secretFiles'

const posixOnly = process.platform === 'win32' ? it.skip : it

let root: string
let dir: string

const plaintext: StorageKeyCodec = {
  available: false,
  encrypt: () => Promise.reject(new Error('not used')),
  decrypt: () => Promise.reject(new Error('not used'))
}

/** A reversible stand-in for safeStorage's asynchronous API (BL-36). */
const keychain: StorageKeyCodec = {
  available: true,
  encrypt: async (plain) => Buffer.from(`enc:${plain}`),
  decrypt: async (encrypted) => ({ plain: encrypted.toString().replace(/^enc:/, '') })
}

const mode = (p: string): number => fs.statSync(p).mode & 0o777

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-secrets-'))
  dir = path.join(root, 'secrets')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('[BL-19] storage key', () => {
  it('creates the key once and reads the same key back', async () => {
    const first = await loadOrCreateStorageKey(dir, plaintext, () => 'generated-key')
    expect(first).toEqual({ key: 'generated-key', created: true })
    const again = await loadOrCreateStorageKey(dir, plaintext, () => 'another-key')
    expect(again).toEqual({ key: 'generated-key', created: false })
  })

  it('stores the key encrypted when a keychain is available', async () => {
    await loadOrCreateStorageKey(dir, keychain, () => 'secret-key')
    expect(fs.readFileSync(path.join(dir, 'storage-key'), 'utf8')).toBe('enc:secret-key')
    expect((await loadOrCreateStorageKey(dir, keychain, () => 'other')).key).toBe('secret-key')
  })

  it('writes the key again when the keychain asks for re-encryption', async () => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'storage-key'), 'enc:secret-key')
    let encryptions = 0
    const rotating: StorageKeyCodec = {
      available: true,
      encrypt: async (plain) => {
        encryptions++
        return Buffer.from(`enc2:${plain}`)
      },
      decrypt: async (encrypted) => ({
        plain: encrypted.toString().replace(/^enc2?:/, ''),
        reEncrypt: true
      })
    }

    const loaded = await loadOrCreateStorageKey(dir, rotating, () => 'unused')

    expect(loaded).toEqual({ key: 'secret-key', created: false })
    expect(encryptions).toBe(1)
    expect(fs.readFileSync(path.join(dir, 'storage-key'), 'utf8')).toBe('enc2:secret-key')
  })

  it('does not write the file again when no re-encryption is requested', async () => {
    await loadOrCreateStorageKey(dir, keychain, () => 'k')
    const before = fs.statSync(path.join(dir, 'storage-key')).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    await loadOrCreateStorageKey(dir, keychain, () => 'unused')
    expect(fs.statSync(path.join(dir, 'storage-key')).mtimeMs).toBe(before)
  })

  posixOnly('creates secrets/ 0700 and storage-key 0600', async () => {
    await loadOrCreateStorageKey(dir, plaintext, () => 'k')
    expect(mode(dir)).toBe(0o700)
    expect(mode(path.join(dir, 'storage-key'))).toBe(0o600)
  })

  posixOnly(
    'tightens a directory and key file left with 0755 / 0644 by an older version',
    async () => {
      fs.mkdirSync(dir, { mode: 0o755 })
      fs.chmodSync(dir, 0o755)
      fs.writeFileSync(path.join(dir, 'storage-key'), 'old-key', { mode: 0o644 })
      fs.chmodSync(path.join(dir, 'storage-key'), 0o644)

      expect((await loadOrCreateStorageKey(dir, plaintext, () => 'new')).key).toBe('old-key')
      expect(mode(dir)).toBe(0o700)
      expect(mode(path.join(dir, 'storage-key'))).toBe(0o600)
    }
  )

  posixOnly('writeSecretFile tightens an existing wider file', () => {
    ensureSecretsDir(dir)
    const file = path.join(dir, 'x')
    fs.writeFileSync(file, 'old', { mode: 0o644 })
    fs.chmodSync(file, 0o644)
    writeSecretFile(file, 'new')
    expect(mode(file)).toBe(0o600)
    expect(fs.readFileSync(file, 'utf8')).toBe('new')
  })
})

describe('[BL-19] legacy JWT secret', () => {
  it('removes a jwt-secret file left by an older version', () => {
    ensureSecretsDir(dir)
    fs.writeFileSync(path.join(dir, 'jwt-secret'), 'persisted-secret')
    expect(removeLegacyJwtSecret(dir)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'jwt-secret'))).toBe(false)
  })

  it('does nothing when there is none', () => {
    expect(removeLegacyJwtSecret(dir)).toBe(false)
  })
})
