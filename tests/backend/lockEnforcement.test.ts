/**
 * [FR-07.5][NFR-02][BL-18] Locking really locks, on every transport.
 *
 * Regressions covered:
 *  - The terminal WebSocket only checked the JWT signature, so a token that a
 *    lock had revoked still opened terminals.
 *  - A lock left open terminal sockets and SFTP progress streams running.
 *  - The main process never heard about locks or the auto-lock policy.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import http, { type Server } from 'http'
import type { AddressInfo } from 'net'
import type { Express } from 'express'
import { createApp, launch, TEST_LAUNCH_SECRET } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { trustTestServer } from './helpers/knownHosts'
import { setupTerminalWebSocket } from '../../backend/src/websocket/terminal.ws'
import { SSHService } from '../../backend/src/services/ssh.service'
import { AppLockService, type LockPolicy } from '../../backend/src/services/app-lock.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

const MASTER_PASSWORD = 'lock-test-password'

let app: Express
let token: string
let httpServer: Server
let port: number
let sshServer: TestSshServer
let profileId: string
const sockets: WebSocket[] = []

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]

async function unlock(): Promise<void> {
  const res = await request(app)
    .post('/api/auth/unlock')
    .set(...launch())
    .send({ password: MASTER_PASSWORD })
  expect(res.status).toBe(200)
  token = res.body.token
}

async function lockNow(): Promise<void> {
  const res = await request(app)
    .post('/api/auth/lock')
    .set(...launch())
    .set(...auth())
  expect(res.status).toBe(200)
}

beforeAll(async () => {
  app = createApp()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  const setup = await request(app)
    .post('/api/auth/setup')
    .set(...launch())
    .send({ password: MASTER_PASSWORD })
  token = setup.body.token

  sshServer = await startTestSshServer()

  await trustTestServer(sshServer)
  const profile = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name: 'Lock test host',
      host: sshServer.host,
      port: sshServer.port,
      username: sshServer.username,
      authMethod: 'password',
      password: sshServer.password
    })
  profileId = profile.body.id

  httpServer = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()))
  setupTerminalWebSocket(httpServer)
  port = (httpServer.address() as AddressInfo).port
})

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate()
  for (const session of SSHService.listSessions()) SSHService.removeSession(session.id)
  if (!CryptoService.getActiveKey()) await unlock()
})

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  await sshServer.close()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

async function connect(): Promise<string> {
  const res = await request(app)
    .post(`/api/profiles/${profileId}/connect`)
    .set(...auth())
  expect(res.status).toBe(200)
  return res.body.sessionId
}

function terminalUrl(sessionId: string, withToken: string): string {
  return `ws://127.0.0.1:${port}/ws/terminal/${sessionId}?token=${encodeURIComponent(withToken)}&launch=${TEST_LAUNCH_SECRET}`
}

interface OpenTerminal {
  ws: WebSocket
  closed: Promise<{ code: number; reason: string }>
}

function openTerminal(sessionId: string): Promise<OpenTerminal> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(terminalUrl(sessionId, token))
    sockets.push(ws)
    const closed = new Promise<{ code: number; reason: string }>((done) =>
      ws.on('close', (code, reason) => done({ code, reason: reason.toString() }))
    )
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'status' && msg.state === 'connected') resolve({ ws, closed })
    })
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    ws.on('error', reject)
  })
}

function consumersOf(sessionId: string): number | undefined {
  return SSHService.listSessions().find((s) => s.id === sessionId)?.consumers
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('[BL-18] token revocation on the terminal WebSocket', () => {
  it('a token revoked by locking cannot open a terminal', async () => {
    const sessionId = await connect()
    const revoked = token
    await lockNow()

    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(terminalUrl(sessionId, revoked))
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? 0)
        ws.terminate()
      })
      ws.on('open', () => resolve(101))
      ws.on('error', () => {})
    })
    expect(status).toBe(401)
  })
})

describe('[BL-18] a lock closes live transports', () => {
  it('closes every open terminal with code 4001 and ends their shells', async () => {
    const sessionId = await connect()
    const first = await openTerminal(sessionId)
    const second = await openTerminal(sessionId)
    expect(consumersOf(sessionId)).toBe(2)

    await lockNow()

    const closes = await Promise.all([first.closed, second.closed])
    expect(closes.map((c) => c.code)).toEqual([4001, 4001])
    await waitFor(() => consumersOf(sessionId) === 0)
  })

  it('ends an open SFTP progress stream', async () => {
    const ended = await new Promise<boolean>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${port}/api/sftp/any-session/progress/up-locktest?token=${encodeURIComponent(token)}`,
        (res) => {
          expect(res.statusCode).toBe(200)
          res.on('data', () => {})
          res.on('end', () => resolve(true))
          lockNow().catch(reject)
        }
      )
      req.on('error', reject)
    })
    expect(ended).toBe(true)
  })

  it('leaves the SSH session itself running (tunnels keep working)', async () => {
    const sessionId = await connect()
    await lockNow()
    expect(SSHService.getSession(sessionId)).toBeDefined()
  })
})

describe('[BL-18] what the main process is told', () => {
  it('announces each lock', async () => {
    let locks = 0
    const stop = AppLockService.onLock(() => locks++)
    try {
      await lockNow()
      expect(locks).toBe(1)
    } finally {
      stop()
    }
  })

  it('publishes the policy after the timeout or the lock mode changes', async () => {
    const published: LockPolicy[] = []
    const stop = AppLockService.onPolicy((policy) => published.push(policy))
    try {
      const put = await request(app)
        .put('/api/config')
        .set(...auth())
        .send({ autoLockMinutes: 7 })
      expect(put.status).toBe(200)
      expect(published.at(-1)).toEqual({ enabled: true, autoLockMinutes: 7 })

      const off = await request(app)
        .post('/api/auth/disable-lock')
        .set(...launch())
        .set(...auth())
        .send({ password: MASTER_PASSWORD })
      expect(off.status).toBe(200)
      expect(published.at(-1)).toEqual({ enabled: false, autoLockMinutes: 7 })

      const on = await request(app)
        .post('/api/auth/setup-password')
        .set(...launch())
        .set(...auth())
        .send({ password: MASTER_PASSWORD })
      expect(on.status).toBe(200)
      token = on.body.token
      expect(published.at(-1)).toEqual({ enabled: true, autoLockMinutes: 7 })
    } finally {
      stop()
    }
  })
})
