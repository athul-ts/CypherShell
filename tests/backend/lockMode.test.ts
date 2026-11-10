/**
 * [FR-07.7][BL-10] Changing the lock mode must never make stored secrets
 * undecryptable.
 *
 * Regression: `POST /auth/setup-password` replaced the key without
 * re-encrypting anything, and `PUT /config { lockEnabled: false }` made the
 * next unlock derive a different key — either way every saved password and
 * private key became unreadable after a restart.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from './helpers/createApp'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let profileId: string
let keyId: string

const PROFILE_PASSWORD = 'server-password-1'

beforeAll(async () => {
  app = createApp()
  await prisma.profile.deleteMany()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

afterAll(async () => {
  await prisma.profile.deleteMany()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]

/** Simulates an app restart: the in-memory key is gone and the user unlocks again. */
async function restartAndUnlock(password?: string): Promise<void> {
  CryptoService.clearActiveKey()
  const res = await request(app)
    .post('/api/auth/unlock')
    .send(password ? { password } : {})
  expect(res.status).toBe(200)
  token = res.body.token
}

/** Decrypts the stored secrets with whatever key the current unlock produced. */
async function readSecrets(): Promise<{ password: string; privateKey: string }> {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } })
  const key = await prisma.sSHKey.findUniqueOrThrow({ where: { id: keyId } })
  return {
    password: CryptoService.decrypt(profile.encryptedPassword as string),
    privateKey: CryptoService.decrypt(key.encryptedPrivateKey)
  }
}

describe('[FR-07.7][BL-10] lock-mode changes preserve encrypted data', () => {
  it('stores secrets on a skip-lock install', async () => {
    const skip = await request(app).post('/api/auth/setup/skip')
    expect(skip.status).toBe(200)
    token = skip.body.token

    const profile = await request(app)
      .post('/api/profiles')
      .set(...auth())
      .send({
        name: 'Rekey host',
        host: 'example.test',
        port: 22,
        username: 'root',
        authMethod: 'password',
        password: PROFILE_PASSWORD
      })
    expect(profile.status).toBe(201)
    profileId = profile.body.id

    const key = await request(app)
      .post('/api/keys/generate')
      .set(...auth())
      .send({ name: 'Rekey key', type: 'ed25519' })
    expect(key.status).toBe(200)
    keyId = key.body.id
  })

  it('setting a master password keeps secrets readable after a restart', async () => {
    const res = await request(app)
      .post('/api/auth/setup-password')
      .set(...auth())
      .send({ password: 'master-one' })
    expect(res.status).toBe(200)
    expect(res.body.unreadableSecrets).toBe(0)

    await restartAndUnlock('master-one')
    const secrets = await readSecrets()
    expect(secrets.password).toBe(PROFILE_PASSWORD)
    expect(secrets.privateKey).toContain('PRIVATE KEY')
  })

  it('reports hasMasterPassword and ignores lockEnabled in PUT /config', async () => {
    const put = await request(app)
      .put('/api/config')
      .set(...auth())
      .send({ lockEnabled: false, autoLockMinutes: 20 })
    expect(put.status).toBe(200)
    expect(put.body.lockEnabled).toBe(true)
    expect(put.body.autoLockMinutes).toBe(20)
    expect(put.body.hasMasterPassword).toBe(true)
    expect(put.body).not.toHaveProperty('masterPasswordHash')
  })

  it('turning lock off with a wrong password changes nothing', async () => {
    const res = await request(app)
      .post('/api/auth/disable-lock')
      .set(...auth())
      .send({ password: 'not-the-password' })
    expect(res.status).toBe(401)

    const status = await request(app).get('/api/auth/status')
    expect(status.body.locked).toBe(true)
    expect((await readSecrets()).password).toBe(PROFILE_PASSWORD)
  })

  it('turning lock off keeps secrets readable after a restart', async () => {
    const res = await request(app)
      .post('/api/auth/disable-lock')
      .set(...auth())
      .send({ password: 'master-one' })
    expect(res.status).toBe(200)
    expect(res.body.unreadableSecrets).toBe(0)

    const status = await request(app).get('/api/auth/status')
    expect(status.body).toEqual({ configured: true, locked: false })

    await restartAndUnlock()
    const secrets = await readSecrets()
    expect(secrets.password).toBe(PROFILE_PASSWORD)
    expect(secrets.privateKey).toContain('PRIVATE KEY')

    const config = await request(app)
      .get('/api/config')
      .set(...auth())
    expect(config.body.hasMasterPassword).toBe(false)
  })

  it('lock can be turned on again after it was turned off', async () => {
    const res = await request(app)
      .post('/api/auth/setup-password')
      .set(...auth())
      .send({ password: 'master-two' })
    expect(res.status).toBe(200)

    await restartAndUnlock('master-two')
    expect((await readSecrets()).password).toBe(PROFILE_PASSWORD)
  })
})

describe('[FR-07.7][BL-10] recovering from the pre-fix lock toggle', () => {
  // The old Settings toggle saved lockEnabled:false but kept the hash and the
  // master-password salt. After a restart the app ran on the storage key, so
  // old secrets stayed under the master key and new ones landed under the
  // storage key.
  it('re-enabling lock with the existing master password makes both sets readable', async () => {
    await prisma.appConfig.update({ where: { id: 'singleton' }, data: { lockEnabled: false } })
    await restartAndUnlock() // storage-key key, master-password salt

    const newer = await request(app)
      .post('/api/profiles')
      .set(...auth())
      .send({
        name: 'Added while lock was off',
        host: 'example.test',
        username: 'root',
        authMethod: 'password',
        password: 'written-under-storage-key'
      })
    expect(newer.status).toBe(201)

    const wrong = await request(app)
      .post('/api/auth/setup-password')
      .set(...auth())
      .send({ password: 'some-new-password' })
    expect(wrong.status).toBe(401)

    const res = await request(app)
      .post('/api/auth/setup-password')
      .set(...auth())
      .send({ password: 'master-two' })
    expect(res.status).toBe(200)
    expect(res.body.unreadableSecrets).toBe(0)

    await restartAndUnlock('master-two')
    expect((await readSecrets()).password).toBe(PROFILE_PASSWORD)
    const added = await prisma.profile.findUniqueOrThrow({ where: { id: newer.body.id } })
    expect(CryptoService.decrypt(added.encryptedPassword as string)).toBe(
      'written-under-storage-key'
    )
  })
})
