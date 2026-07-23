import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from './helpers/createApp'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express

beforeAll(async () => {
  app = createApp()
  // Clean slate — remove any config left by a prior test file.
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

afterAll(async () => {
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})

describe('GET /api/auth/status', () => {
  it('returns configured:false before setup', async () => {
    const res = await request(app).get('/api/auth/status')
    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(false)
  })
})

describe('POST /api/auth/setup', () => {
  it('rejects a short password', async () => {
    const res = await request(app).post('/api/auth/setup').send({ password: '123' })
    expect(res.status).toBe(400)
  })

  it('creates config and returns a JWT', async () => {
    const res = await request(app).post('/api/auth/setup').send({ password: 'test-password-123' })
    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe('string')
    expect(res.body.token.split('.').length).toBe(3) // valid JWT
  })

  it('returns 409 when called a second time', async () => {
    const res = await request(app).post('/api/auth/setup').send({ password: 'another-password' })
    expect(res.status).toBe(409)
  })
})

describe('GET /api/auth/status (after setup)', () => {
  it('returns configured:true', async () => {
    const res = await request(app).get('/api/auth/status')
    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(true)
    expect(res.body.locked).toBe(true)
  })
})

describe('POST /api/auth/unlock', () => {
  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/unlock').send({ password: 'wrong-password' })
    expect(res.status).toBe(401)
  })

  it('unlocks with correct password and returns JWT', async () => {
    const res = await request(app)
      .post('/api/auth/unlock')
      .send({ password: 'test-password-123' })
    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe('string')
  })
})

describe('JWT authentication', () => {
  it('rejects protected routes without a token', async () => {
    const res = await request(app).get('/api/profiles')
    expect(res.status).toBe(401)
  })

  it('allows protected routes with a valid token', async () => {
    const { body } = await request(app)
      .post('/api/auth/unlock')
      .send({ password: 'test-password-123' })
    const res = await request(app)
      .get('/api/profiles')
      .set('Authorization', `Bearer ${body.token}`)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/auth/lock', () => {
  it('clears the active key', async () => {
    const { body } = await request(app)
      .post('/api/auth/unlock')
      .send({ password: 'test-password-123' })
    const res = await request(app)
      .post('/api/auth/lock')
      .set('Authorization', `Bearer ${body.token}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
