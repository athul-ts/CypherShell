import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from './helpers/createApp'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string

const baseProfile = {
  name: 'Test Server',
  host: '192.168.1.1',
  port: 22,
  username: 'admin',
  authMethod: 'key'
}

beforeAll(async () => {
  app = createApp()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  const res = await request(app).post('/api/auth/setup/skip')
  token = res.body.token
})

afterAll(async () => {
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('GET /api/profiles', () => {
  it('returns empty list initially', async () => {
    const res = await request(app).get('/api/profiles').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(0)
  })
})

describe('POST /api/profiles', () => {
  it('creates a profile and returns it', async () => {
    const res = await request(app)
      .post('/api/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send(baseProfile)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('id')
    expect(res.body.name).toBe('Test Server')
    expect(res.body.host).toBe('192.168.1.1')
  })
})

describe('GET /api/profiles (with data)', () => {
  it('returns the created profile', async () => {
    const res = await request(app).get('/api/profiles').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(1)
    expect(res.body[0].name).toBe('Test Server')
  })
})

describe('GET /api/profiles/:id', () => {
  let profileId: string

  beforeAll(async () => {
    const list = await request(app).get('/api/profiles').set('Authorization', `Bearer ${token}`)
    profileId = list.body[0].id
  })

  it('returns the profile by id', async () => {
    const res = await request(app)
      .get(`/api/profiles/${profileId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(profileId)
  })

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/profiles/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/profiles/:id', () => {
  let profileId: string

  beforeAll(async () => {
    const list = await request(app).get('/api/profiles').set('Authorization', `Bearer ${token}`)
    profileId = list.body[0].id
  })

  it('updates the profile name', async () => {
    const res = await request(app)
      .put(`/api/profiles/${profileId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Server' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Updated Server')
  })
})

describe('DELETE /api/profiles/:id', () => {
  let profileId: string

  beforeAll(async () => {
    const list = await request(app).get('/api/profiles').set('Authorization', `Bearer ${token}`)
    profileId = list.body[0].id
  })

  it('deletes the profile', async () => {
    const res = await request(app)
      .delete(`/api/profiles/${profileId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('profile is gone after deletion', async () => {
    const res = await request(app).get('/api/profiles').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(0)
  })
})
