/**
 * [FR-07.8][BL-39] Change the master password: every secret is re-encrypted under the
 * new key in one transaction, and a failure changes nothing.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { createApp as createBackendApp } from '../../backend/src/app'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'
import { SecretsService } from '../../backend/src/services/secrets.service'

let app: Express
let token: string
let profileId: string
let keyId: string

const OLD = 'old-master-pass'
const NEW = 'brand-new-master-pass'
const PROFILE_PASSWORD = 'server-password-1'

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]
const change = (body: object, a: Express = app): request.Test =>
  request(a)
    .post('/api/auth/change-password')
    .set(...launch())
    .set(...auth())
    .send(body)

async function restartAndUnlock(password: string): Promise<number> {
  CryptoService.clearActiveKey()
  const res = await request(app)
    .post('/api/auth/unlock')
    .set(...launch())
    .send({ password })
  if (res.status === 200) token = res.body.token
  return res.status
}

async function readSecrets(): Promise<{ password: string; privateKey: string }> {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } })
  const key = await prisma.sSHKey.findUniqueOrThrow({ where: { id: keyId } })
  return {
    password: CryptoService.decrypt(profile.encryptedPassword as string),
    privateKey: CryptoService.decrypt(key.encryptedPrivateKey)
  }
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
  profileId = (
    await request(app)
      .post('/api/profiles')
      .set(...auth())
      .send({
        name: 'Change pw host',
        host: 'example.test',
        port: 22,
        username: 'root',
        authMethod: 'password',
        password: PROFILE_PASSWORD
      })
  ).body.id
  keyId = (
    await request(app)
      .post('/api/keys/generate')
      .set(...auth())
      .send({ name: 'Change pw key', type: 'ed25519' })
  ).body.id
})

afterAll(async () => {
  await prisma.profile.deleteMany()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

afterEach(() => vi.restoreAllMocks())

describe('[BL-39] change master password', () => {
  it('returns 400 while app lock is off', async () => {
    const res = await change({ currentPassword: 'x', newPassword: NEW })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/lock is off/i)
  })

  it('turns lock on', async () => {
    const res = await request(app)
      .post('/api/auth/setup-password')
      .set(...launch())
      .set(...auth())
      .send({ password: OLD })
    expect(res.status).toBe(200)
    token = res.body.token
  })

  it('requires a token', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(...launch())
      .send({ currentPassword: OLD, newPassword: NEW })
    expect(res.status).toBe(401)
  })

  it('a wrong current password returns 401 and the old password still unlocks', async () => {
    const res = await change({ currentPassword: 'wrong-password', newPassword: NEW })
    expect(res.status).toBe(401)
    expect(await restartAndUnlock(OLD)).toBe(200)
  })

  it('rejects a short or unchanged new password with 400', async () => {
    expect((await change({ currentPassword: OLD, newPassword: 'short' })).status).toBe(400)
    expect((await change({ currentPassword: OLD, newPassword: OLD })).status).toBe(400)
    expect((await change({ currentPassword: OLD })).status).toBe(400)
  })

  it('a failure while re-encrypting changes nothing', async () => {
    vi.spyOn(SecretsService, 'rekey').mockRejectedValueOnce(new Error('disk full'))
    const before = await prisma.appConfig.findUniqueOrThrow({ where: { id: 'singleton' } })

    const res = await change({ currentPassword: OLD, newPassword: NEW })
    expect(res.status).toBe(500)

    const after = await prisma.appConfig.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(after.masterPasswordHash).toBe(before.masterPasswordHash)
    expect(after.encryptionKeySalt).toBe(before.encryptionKeySalt)
    expect((await readSecrets()).password).toBe(PROFILE_PASSWORD)
    expect(await restartAndUnlock(OLD)).toBe(200)
  })

  it('changes the password: old fails, new unlocks, secrets still decrypt', async () => {
    const before = await prisma.appConfig.findUniqueOrThrow({ where: { id: 'singleton' } })

    const res = await change({ currentPassword: OLD, newPassword: NEW })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, unreadableSecrets: 0 })

    const after = await prisma.appConfig.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(after.masterPasswordHash).not.toBe(before.masterPasswordHash)
    expect(after.encryptionKeySalt).not.toBe(before.encryptionKeySalt)
    expect(after.lockEnabled).toBe(true)

    // Secrets are readable right away with the in-memory key…
    expect((await readSecrets()).password).toBe(PROFILE_PASSWORD)
    // …and after a restart with the new password only.
    expect(await restartAndUnlock(OLD)).toBe(401)
    expect(await restartAndUnlock(NEW)).toBe(200)
    const secrets = await readSecrets()
    expect(secrets.password).toBe(PROFILE_PASSWORD)
    expect(secrets.privateKey).toContain('PRIVATE KEY')
  })

  it('shares the 5-per-minute limit of the other password endpoints', async () => {
    const limited = createBackendApp({ rateLimit: true })
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await change(
            { currentPassword: 'wrong-password', newPassword: 'another-new-pass' },
            limited
          )
        ).status
      )
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(statuses[5]).toBe(429)
  })
})
