/**
 * [FR-10.6][BL-33] Overwriting a key from a .cskb bundle replaces it in place.
 *
 * Regression: Overwrite deleted the existing key and then created a new one.
 * The profiles that used it were unlinked (`onDelete: SetNull`), and a failure
 * after the delete — such as an unreadable key in the bundle — lost the old
 * key for nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let keyId: string
let profileId: string

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]

async function generate(name: string): Promise<string> {
  const res = await request(app)
    .post('/api/keys/generate')
    .set(...auth())
    .send({ name, type: 'ed25519' })
  expect(res.status).toBe(200)
  return res.body.id
}

/** A bundle that claims to be the key `asName`, holding the content of key `sourceId`. */
async function bundleOf(sourceId: string, asName: string): Promise<Record<string, unknown>> {
  const res = await request(app)
    .post(`/api/keys/${sourceId}/export-bundle`)
    .set(...auth())
    .send({ passphrase: 'bundle-pass', confirmPassphrase: 'bundle-pass' })
  expect(res.status).toBe(200)
  return { ...res.body, keyName: asName }
}

function importBundle(bundle: unknown, resolution: string): request.Test {
  return request(app)
    .post('/api/keys/import-bundle')
    .set(...auth())
    .send({ bundle, passphrase: 'bundle-pass', resolution })
}

beforeAll(async () => {
  app = createApp()
  await prisma.profile.deleteMany()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  token = (
    await request(app)
      .post('/api/auth/setup/skip')
      .set(...launch())
  ).body.token

  keyId = await generate('Deploy key')
  const profile = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name: 'Uses deploy key',
      host: 'h.example',
      username: 'u',
      authMethod: 'key',
      sshKeyId: keyId
    })
  expect(profile.status).toBe(201)
  profileId = profile.body.id
})

afterAll(async () => {
  await prisma.profile.deleteMany()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('[FR-10.6][BL-33] Overwrite', () => {
  it('keeps the key id and every profile link, with the new key content', async () => {
    const before = await prisma.sSHKey.findUniqueOrThrow({ where: { id: keyId } })
    const otherId = await generate('Replacement source')
    const other = await prisma.sSHKey.findUniqueOrThrow({ where: { id: otherId } })

    const res = await importBundle(await bundleOf(otherId, 'Deploy key'), 'overwrite')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('imported')

    const after = await prisma.sSHKey.findUniqueOrThrow({ where: { id: keyId } }) // same id
    expect(after.fingerprint).toBe(other.fingerprint)
    expect(after.fingerprint).not.toBe(before.fingerprint)
    expect(CryptoService.decrypt(after.encryptedPrivateKey)).toContain('PRIVATE KEY')
    expect(await prisma.sSHKey.count({ where: { name: 'Deploy key' } })).toBe(1)

    const profile = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } })
    expect(profile.sshKeyId).toBe(keyId) // still linked
  })

  it('a failed overwrite leaves the old key and its links untouched', async () => {
    const before = await prisma.sSHKey.findUniqueOrThrow({ where: { id: keyId } })
    const garbage = await CryptoService.encryptWithPassphrase(
      'this is not a private key',
      'bundle-pass'
    )
    const bundle = {
      version: 1,
      keyName: 'Deploy key',
      keyType: 'ed25519',
      description: null,
      publicKey: 'ssh-ed25519 AAAA',
      ...garbage
    }

    const res = await importBundle(bundle, 'overwrite')
    expect(res.status).toBe(400)

    const after = await prisma.sSHKey.findUnique({ where: { id: keyId } })
    expect(after?.fingerprint).toBe(before.fingerprint)
    expect(after?.encryptedPrivateKey).toBe(before.encryptedPrivateKey)
    const profile = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } })
    expect(profile.sshKeyId).toBe(keyId)
  })

  it('Rename still creates a second key and leaves the first alone', async () => {
    const otherId = await generate('Another source')
    const res = await importBundle(await bundleOf(otherId, 'Deploy key'), 'rename')
    expect(res.status).toBe(200)

    expect(await prisma.sSHKey.count({ where: { name: 'Deploy key' } })).toBe(1)
    expect(await prisma.sSHKey.count({ where: { name: 'Deploy key (imported)' } })).toBe(1)
  })
})
