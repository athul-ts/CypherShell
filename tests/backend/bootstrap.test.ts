/**
 * [FR-07.1][BL-10] First-run detection must survive the backend's startup jobs.
 *
 * Regression: the startup audit-log purge used to read the config through a
 * helper that inserted the AppConfig row, so a fresh install reported itself
 * as "configured, unlocked" and the setup wizard never appeared.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from './helpers/createApp'
import { purgeExpiredLogs } from '../../backend/src/app'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express

beforeAll(async () => {
  app = createApp()
  await prisma.auditLog.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

afterAll(async () => {
  await prisma.auditLog.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('[FR-07.1][BL-10] fresh install', () => {
  it('the startup log purge does not create the config row', async () => {
    await purgeExpiredLogs()
    expect(await prisma.appConfig.count()).toBe(0)
  })

  it('GET /api/auth/status still reports configured:false after startup jobs ran', async () => {
    await purgeExpiredLogs()
    const res = await request(app).get('/api/auth/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ configured: false, locked: false })
  })

  it('first-run setup succeeds after startup jobs ran', async () => {
    await purgeExpiredLogs()
    const res = await request(app).post('/api/auth/setup').send({ password: 'first-run-password' })
    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe('string')
  })
})

describe('[FR-08.7] audit-log purge once configured', () => {
  it('deletes entries older than the retention period and keeps recent ones', async () => {
    const config = await prisma.appConfig.findUniqueOrThrow({ where: { id: 'singleton' } })
    const tooOld = new Date(Date.now() - (config.logRetentionDays + 1) * 24 * 60 * 60 * 1000)
    await prisma.auditLog.create({
      data: { type: 'connection', detail: 'old entry', success: true, timestamp: tooOld }
    })
    await prisma.auditLog.create({
      data: { type: 'connection', detail: 'recent entry', success: true }
    })

    await purgeExpiredLogs()

    const remaining = await prisma.auditLog.findMany({ select: { detail: true } })
    expect(remaining.map((log) => log.detail)).toEqual(['recent entry'])
  })
})
