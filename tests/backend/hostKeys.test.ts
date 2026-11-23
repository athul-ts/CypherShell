/**
 * [FR-11][BL-38] SSH host-key verification against the in-process ssh2 server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import sshpk from 'sshpk'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { SSHService } from '../../backend/src/services/ssh.service'
import { fingerprintOf, keyTypeOf } from '../../backend/src/services/known-host.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let server: TestSshServer
let profileId: string

const OTHER_FINGERPRINT = 'SHA256:' + 'B'.repeat(43)

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]
const connect = (body?: object): request.Test =>
  request(app)
    .post(`/api/profiles/${profileId}/connect`)
    .set(...auth())
    .send(body ?? {})

beforeAll(async () => {
  app = createApp()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.knownHost.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  token = (
    await request(app)
      .post('/api/auth/setup/skip')
      .set(...launch())
  ).body.token

  server = await startTestSshServer()
  const res = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name: 'Host key host',
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: 'password',
      password: server.password
    })
  profileId = res.body.id
})

afterAll(async () => {
  for (const s of SSHService.listSessions()) SSHService.removeSession(s.id)
  await server.close()
})

beforeEach(async () => {
  for (const s of SSHService.listSessions()) SSHService.removeSession(s.id)
  await prisma.knownHost.deleteMany()
  await prisma.auditLog.deleteMany({ where: { type: 'host_key' } })
})

const hostKeyLog = async (): Promise<string[]> =>
  (await prisma.auditLog.findMany({ where: { type: 'host_key' } })).map((l) => l.detail)

describe('[BL-38] fingerprint helpers', () => {
  it('fingerprintOf matches the SHA-256 fingerprint sshpk computes', () => {
    const blob = Buffer.from(server.hostKey.publicKey, 'base64')
    const key = sshpk.parseKey(`${server.hostKey.type} ${server.hostKey.publicKey}`, 'ssh')
    expect(fingerprintOf(blob)).toBe(key.fingerprint('sha256').toString())
    expect(keyTypeOf(blob)).toBe(server.hostKey.type)
  })

  it('keyTypeOf rejects a malformed blob', () => {
    expect(() => keyTypeOf(Buffer.from([0, 0]))).toThrow()
    expect(() => keyTypeOf(Buffer.from([0, 0, 0, 200, 1]))).toThrow()
  })
})

describe('[BL-38] connect with host-key verification', () => {
  it('first connect returns 409 HOST_KEY_UNKNOWN and sends no credentials', async () => {
    const before = server.authAttempts()
    const res = await connect()
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'HOST_KEY_UNKNOWN',
      host: server.host,
      port: server.port,
      keyType: server.hostKey.type,
      fingerprint: server.hostKey.fingerprint
    })
    expect(server.authAttempts()).toBe(before)
    expect(await prisma.knownHost.count()).toBe(0)
  })

  it('accepting the shown fingerprint connects, stores the key and audits it', async () => {
    const res = await connect({ acceptHostKey: server.hostKey.fingerprint })
    expect(res.status).toBe(200)
    expect(res.body.sessionId).toBeTruthy()
    const row = await prisma.knownHost.findFirstOrThrow()
    expect(row).toMatchObject({
      host: server.host,
      port: server.port,
      keyType: server.hostKey.type,
      fingerprint: server.hostKey.fingerprint,
      publicKey: server.hostKey.publicKey
    })
    expect(await hostKeyLog()).toContain('Host key trusted')
  })

  it('a wrong acceptHostKey stores nothing and is refused', async () => {
    const before = server.authAttempts()
    const res = await connect({ acceptHostKey: 'SHA256:' + 'A'.repeat(43) })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('HOST_KEY_UNKNOWN')
    expect(await prisma.knownHost.count()).toBe(0)
    expect(server.authAttempts()).toBe(before)
  })

  it('rejects a malformed acceptHostKey with 400', async () => {
    expect((await connect({ acceptHostKey: 'not-a-fingerprint' })).status).toBe(400)
  })

  it('a trusted host connects without a prompt and lastSeenAt advances', async () => {
    await connect({ acceptHostKey: server.hostKey.fingerprint })
    const first = await prisma.knownHost.findFirstOrThrow()
    await new Promise((r) => setTimeout(r, 20))
    expect((await connect()).status).toBe(200)
    const second = await prisma.knownHost.findFirstOrThrow()
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime())
  })

  it('a changed key returns 409 HOST_KEY_MISMATCH and cannot be overridden', async () => {
    await prisma.knownHost.create({
      data: {
        host: server.host,
        port: server.port,
        keyType: 'ssh-ed25519',
        fingerprint: OTHER_FINGERPRINT,
        publicKey: 'AAAA'
      }
    })
    const before = server.authAttempts()
    const res = await connect({ acceptHostKey: server.hostKey.fingerprint })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'HOST_KEY_MISMATCH',
      fingerprint: server.hostKey.fingerprint,
      knownFingerprint: OTHER_FINGERPRINT
    })
    expect(server.authAttempts()).toBe(before)
    expect((await prisma.knownHost.findFirstOrThrow()).fingerprint).toBe(OTHER_FINGERPRINT)
    expect(await hostKeyLog()).toContain('Host key changed — connection blocked')
  })

  it('a host-key stop writes no "connection failed" entry', async () => {
    await prisma.auditLog.deleteMany({ where: { type: 'connection' } })
    await connect()
    expect(await prisma.auditLog.count({ where: { type: 'connection', success: false } })).toBe(0)
  })

  it('records the confirmation request in the audit log', async () => {
    await connect()
    expect(await hostKeyLog()).toContain('Unknown host key — confirmation requested')
  })
})

describe('[BL-38] known hosts API', () => {
  it('lists, removes and prompts again after removal', async () => {
    await connect({ acceptHostKey: server.hostKey.fingerprint })
    const list = await request(app)
      .get('/api/known-hosts')
      .set(...auth())
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)

    const del = await request(app)
      .delete(`/api/known-hosts/${list.body[0].id}`)
      .set(...auth())
    expect(del.status).toBe(200)
    expect((await connect()).body.code).toBe('HOST_KEY_UNKNOWN')
    expect(await hostKeyLog()).toContain('Known host removed')
  })

  it('returns 404 for an unknown id', async () => {
    const res = await request(app)
      .delete('/api/known-hosts/nope')
      .set(...auth())
    expect(res.status).toBe(404)
  })

  it('requires a token', async () => {
    expect((await request(app).get('/api/known-hosts')).status).toBe(401)
    expect((await request(app).delete('/api/known-hosts/x')).status).toBe(401)
  })

  it('the audit log accepts the host_key filter', async () => {
    await connect()
    const res = await request(app)
      .get('/api/audit?type=host_key')
      .set(...auth())
    expect(res.status).toBe(200)
    expect(res.body.total).toBeGreaterThan(0)
  })
})
