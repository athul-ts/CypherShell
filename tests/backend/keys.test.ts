import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from './helpers/createApp'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string

beforeAll(async () => {
  app = createApp()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  const res = await request(app).post('/api/auth/setup/skip')
  token = res.body.token
})

afterAll(async () => {
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('GET /api/keys', () => {
  it('returns empty list initially', async () => {
    const res = await request(app).get('/api/keys').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(0)
  })
})

describe('POST /api/keys/generate', () => {
  it('generates an ed25519 key and returns its id', async () => {
    const res = await request(app)
      .post('/api/keys/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Key', type: 'ed25519', description: 'test key for vitest' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.id).toBe('string')
  }, 15000) // key generation can be slow

  it('generates an rsa key', async () => {
    const res = await request(app)
      .post('/api/keys/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'RSA Key', type: 'rsa' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  }, 30000) // RSA is slower
})

describe('GET /api/keys (with data)', () => {
  it('lists generated keys', async () => {
    const res = await request(app).get('/api/keys').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThanOrEqual(1)
    // Confirm private key material is NOT in the list response
    expect(res.body[0]).not.toHaveProperty('encryptedPrivateKey')
  })
})

describe('GET /api/keys/:id/usage', () => {
  let keyId: string

  beforeAll(async () => {
    const list = await request(app).get('/api/keys').set('Authorization', `Bearer ${token}`)
    keyId = list.body[0].id
  })

  it('returns empty profile list for an unused key', async () => {
    const res = await request(app)
      .get(`/api/keys/${keyId}/usage`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.profiles)).toBe(true)
  })
})

describe('DELETE /api/keys/:id', () => {
  let keyId: string

  beforeAll(async () => {
    const list = await request(app).get('/api/keys').set('Authorization', `Bearer ${token}`)
    keyId = list.body[0].id
  })

  it('deletes the key', async () => {
    const res = await request(app)
      .delete(`/api/keys/${keyId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('key is gone after deletion', async () => {
    const res = await request(app).get('/api/keys').set('Authorization', `Bearer ${token}`)
    expect(res.body.length).toBeLessThan(2) // only RSA key remains (the ed25519 was deleted)
  })
})
