/**
 * [FR-01.9][BL-40] Password profiles log in to servers that offer only keyboard-interactive.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { startTestSshServer, type TestSshServer, type TestAuthMode } from './helpers/sshServer'
import { trustTestServer } from './helpers/knownHosts'
import { SSHService } from '../../backend/src/services/ssh.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
const servers: TestSshServer[] = []

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]

async function profileFor(
  server: TestSshServer,
  password: string,
  authMethod = 'password'
): Promise<string> {
  const res = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name: `KI ${server.port}`,
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod,
      ...(authMethod === 'password' ? { password } : {}),
      ...(authMethod !== 'password' ? { sshKeyId: keyId } : {})
    })
  expect(res.status).toBe(201)
  return res.body.id
}

async function serverWith(mode: TestAuthMode): Promise<TestSshServer> {
  const server = await startTestSshServer({ authMode: mode })
  servers.push(server)
  await trustTestServer(server)
  return server
}

const connect = (profileId: string): request.Test =>
  request(app)
    .post(`/api/profiles/${profileId}/connect`)
    .set(...auth())
    .send({})

let keyId: string

beforeAll(async () => {
  app = createApp()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  token = (
    await request(app)
      .post('/api/auth/setup/skip')
      .set(...launch())
  ).body.token
  keyId = (
    await request(app)
      .post('/api/keys/generate')
      .set(...auth())
      .send({ name: 'KI key', type: 'ed25519' })
  ).body.id
})

beforeEach(() => {
  for (const s of SSHService.listSessions()) SSHService.removeSession(s.id)
})

afterAll(async () => {
  for (const s of SSHService.listSessions()) SSHService.removeSession(s.id)
  for (const s of servers) await s.close()
})

describe('[BL-40] keyboard-interactive login', () => {
  it('a keyboard-interactive-only server accepts the stored password', async () => {
    const server = await serverWith('keyboard-interactive')
    const res = await connect(await profileFor(server, server.password))
    expect(res.status).toBe(200)
    expect(res.body.sessionId).toBeTruthy()
    expect(server.authMethodsTried()).toContain('keyboard-interactive')
  })

  it('a wrong password fails', async () => {
    const server = await serverWith('keyboard-interactive')
    const res = await connect(await profileFor(server, 'not-the-password'))
    expect(res.status).toBe(500)
    expect(res.body.error).not.toMatch(/verification step/i)
  })

  it('a server that asks for a one-time code fails with a clear message', async () => {
    const server = await serverWith('otp')
    const res = await connect(await profileFor(server, server.password))
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/additional verification step/i)
  })

  it('a visible prompt is not answered with the password', async () => {
    const server = await serverWith('visible-prompt')
    const res = await connect(await profileFor(server, server.password))
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/additional verification step/i)
  })

  it('a plain password server still logs in without keyboard-interactive', async () => {
    const server = await serverWith('password')
    const res = await connect(await profileFor(server, server.password))
    expect(res.status).toBe(200)
    expect(server.authMethodsTried()).not.toContain('keyboard-interactive')
  })

  it('key profiles never attempt keyboard-interactive', async () => {
    const server = await serverWith('keyboard-interactive')
    const res = await connect(await profileFor(server, '', 'key'))
    expect(res.status).toBe(500)
    expect(server.authMethodsTried()).not.toContain('keyboard-interactive')
  })
})
