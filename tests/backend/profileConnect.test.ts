/**
 * [FR-01.2][BL-31] A successful connection records when the profile was last
 * connected; a failed one does not.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { trustTestServer } from './helpers/knownHosts'
import { SSHService } from '../../backend/src/services/ssh.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let sshServer: TestSshServer

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]

beforeAll(async () => {
  app = createApp()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  token = (
    await request(app)
      .post('/api/auth/setup/skip')
      .set(...launch())
  ).body.token
  sshServer = await startTestSshServer()
  await trustTestServer(sshServer)
})

afterEach(() => {
  for (const session of SSHService.listSessions()) SSHService.removeSession(session.id)
})

afterAll(async () => {
  await sshServer.close()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

async function createProfile(name: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name,
      host: sshServer.host,
      port: sshServer.port,
      username: sshServer.username,
      authMethod: 'password',
      password
    })
  return res.body.id
}

async function lastConnectedAt(id: string): Promise<string | null> {
  const res = await request(app)
    .get('/api/profiles')
    .set(...auth())
  return res.body.find((p: { id: string }) => p.id === id).lastConnectedAt
}

describe('[FR-01.2][BL-31] lastConnectedAt', () => {
  it('is null before the first connection', async () => {
    const id = await createProfile('Never used', sshServer.password)
    expect(await lastConnectedAt(id)).toBeNull()
  })

  it('is set to now after a successful connection', async () => {
    const id = await createProfile('Good login', sshServer.password)
    const before = Date.now()
    const res = await request(app)
      .post(`/api/profiles/${id}/connect`)
      .set(...auth())
    expect(res.status).toBe(200)

    const stamp = await lastConnectedAt(id)
    expect(stamp).not.toBeNull()
    expect(new Date(stamp as string).getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('stays null when the connection fails', async () => {
    const id = await createProfile('Wrong password', 'not-the-password')
    const res = await request(app)
      .post(`/api/profiles/${id}/connect`)
      .set(...auth())
    expect(res.status).toBe(500)
    expect(await lastConnectedAt(id)).toBeNull()
  })
})
