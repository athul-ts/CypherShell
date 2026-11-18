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
  encrypt: () => {
    throw new Error('not used')
  },
  decrypt: () => {
    throw new Error('not used')
  }
}

/** A reversible stand-in for safeStorage. */
const keychain: StorageKeyCodec = {
  available: true,
  encrypt: (plain) => Buffer.from(`enc:${plain}`),
  decrypt: (encrypted) => encrypted.toString().replace(/^enc:/, '')
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
  it('creates the key once and reads the same key back', () => {
    const first = loadOrCreateStorageKey(dir, plaintext, () => 'generated-key')
    expect(first).toEqual({ key: 'generated-key', created: true })
    const again = loadOrCreateStorageKey(dir, plaintext, () => 'another-key')
    expect(again).toEqual({ key: 'generated-key', created: false })
  })

  it('stores the key encrypted when a keychain is available', () => {
    loadOrCreateStorageKey(dir, keychain, () => 'secret-key')
    expect(fs.readFileSync(path.join(dir, 'storage-key'), 'utf8')).toBe('enc:secret-key')
    expect(loadOrCreateStorageKey(dir, keychain, () => 'other').key).toBe('secret-key')
  })

  posixOnly('creates secrets/ 0700 and storage-key 0600', () => {
    loadOrCreateStorageKey(dir, plaintext, () => 'k')
    expect(mode(dir)).toBe(0o700)
    expect(mode(path.join(dir, 'storage-key'))).toBe(0o600)
  })

  posixOnly('tightens a directory and key file left with 0755 / 0644 by an older version', () => {
    fs.mkdirSync(dir, { mode: 0o755 })
    fs.chmodSync(dir, 0o755)
    fs.writeFileSync(path.join(dir, 'storage-key'), 'old-key', { mode: 0o644 })
    fs.chmodSync(path.join(dir, 'storage-key'), 0o644)

    expect(loadOrCreateStorageKey(dir, plaintext, () => 'new').key).toBe('old-key')
    expect(mode(dir)).toBe(0o700)
    expect(mode(path.join(dir, 'storage-key'))).toBe(0o600)
  })

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
