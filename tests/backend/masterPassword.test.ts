/**
 * [FR-07.1][FR-07.7][BL-26] New master passwords need at least 10
 * characters; passwords set before the rule keep working.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express

beforeEach(async () => {
  app = createApp()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

afterAll(async () => {
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

/** A config written before BL-26, with a 6-character master password. */
async function legacyConfig(lockEnabled: boolean): Promise<void> {
  await prisma.appConfig.create({
    data: {
      id: 'singleton',
      lockEnabled,
      masterPasswordHash: await CryptoService.hashPassword('short1'),
      encryptionKeySalt: CryptoService.generateSalt()
    }
  })
}

describe('[BL-26] first-run setup', () => {
  it('refuses 9 characters and accepts 10', async () => {
    const short = await request(app)
      .post('/api/auth/setup')
      .set(...launch())
      .send({ password: '123456789' })
    expect(short.status).toBe(400)
    expect(short.body.error).toBe('Password must be at least 10 characters.')

    const ok = await request(app)
      .post('/api/auth/setup')
      .set(...launch())
      .send({ password: '1234567890' })
    expect(ok.status).toBe(200)
  })
})

describe('[BL-26] setting a master password later', () => {
  it('refuses a new 9-character password and accepts 10', async () => {
    const token = (
      await request(app)
        .post('/api/auth/setup/skip')
        .set(...launch())
    ).body.token
    const short = await request(app)
      .post('/api/auth/setup-password')
      .set(...launch())
      .set('Authorization', `Bearer ${token}`)
      .send({ password: '123456789' })
    expect(short.status).toBe(400)

    const ok = await request(app)
      .post('/api/auth/setup-password')
      .set(...launch())
      .set('Authorization', `Bearer ${token}`)
      .send({ password: '1234567890' })
    expect(ok.status).toBe(200)
  })
})

describe('[BL-26] passwords set before the rule', () => {
  it('a shorter existing master password still unlocks', async () => {
    await legacyConfig(true)
    const res = await request(app)
      .post('/api/auth/unlock')
      .set(...launch())
      .send({ password: 'short1' })
    expect(res.status).toBe(200)
  })

  it('a shorter existing master password still re-enables lock', async () => {
    await legacyConfig(false) // lock switched off by the pre-BL-10 toggle, hash kept
    const token = (
      await request(app)
        .post('/api/auth/unlock')
        .set(...launch())
        .send({})
    ).body.token
    const res = await request(app)
      .post('/api/auth/setup-password')
      .set(...launch())
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'short1' })
    expect(res.status).toBe(200)
    const status = await request(app)
      .get('/api/auth/status')
      .set(...launch())
    expect(status.body.locked).toBe(true)
  })
})
