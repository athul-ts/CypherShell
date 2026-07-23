/**
 * Key regression test: verifies that GET /api/config and PUT /api/config
 * never expose masterPasswordHash or encryptionKeySalt in their responses.
 * This exercises the `stripSecrets()` helper added in the lint fix.
 */
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
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  const res = await request(app).post('/api/auth/setup/skip')
  token = res.body.token
})

afterAll(async () => {
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('GET /api/config', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/config')
    expect(res.status).toBe(401)
  })

  it('returns config fields', async () => {
    const res = await request(app).get('/api/config').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('theme')
    expect(res.body).toHaveProperty('defaultFontSize')
    expect(res.body).toHaveProperty('logRetentionDays')
  })

  it('NEVER exposes masterPasswordHash in the response', async () => {
    const res = await request(app).get('/api/config').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('masterPasswordHash')
  })

  it('NEVER exposes encryptionKeySalt in the response', async () => {
    const res = await request(app).get('/api/config').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('encryptionKeySalt')
  })
})

describe('PUT /api/config', () => {
  it('updates config and still strips secrets', async () => {
    const res = await request(app)
      .put('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultFontSize: 16, logRetentionDays: 30 })
    expect(res.status).toBe(200)
    expect(res.body.defaultFontSize).toBe(16)
    expect(res.body.logRetentionDays).toBe(30)
    expect(res.body).not.toHaveProperty('masterPasswordHash')
    expect(res.body).not.toHaveProperty('encryptionKeySalt')
  })

  it('persists the updated value on a subsequent GET', async () => {
    const res = await request(app).get('/api/config').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.defaultFontSize).toBe(16)
  })
})
