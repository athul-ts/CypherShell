/**
 * [FR-02.1][FR-02.8][FR-03.5][BL-11] SSH session lifecycle against a real
 * (in-process) SSH server.
 *
 * Regressions covered:
 *  - The terminal WebSocket took the session id from the raw URL, which since
 *    SEC-03 carries `?token=…`, so every terminal was rejected as
 *    "Invalid session ID".
 *  - The orphan reaper closed sessions 60 s after their last lookup, even
 *    with a terminal or tunnel in use.
 *  - Every closed shell scheduled a teardown of the whole SSH session.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import net, { type AddressInfo } from 'net'
import type { Server } from 'http'
import type { Express } from 'express'
import { createApp } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { setupTerminalWebSocket } from '../../backend/src/websocket/terminal.ws'
import { SSHService } from '../../backend/src/services/ssh.service'
import { TunnelService } from '../../backend/src/services/tunnel.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let httpServer: Server
let wsPort: number
let sshServer: TestSshServer
let profileId: string
const sockets: WebSocket[] = []

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]

beforeAll(async () => {
  app = createApp()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  token = (await request(app).post('/api/auth/setup/skip')).body.token

  sshServer = await startTestSshServer()
  const profile = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name: 'Session test host',
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
  wsPort = (httpServer.address() as AddressInfo).port
})

afterEach(() => {
  for (const ws of sockets.splice(0)) ws.close()
  for (const session of SSHService.listSessions()) SSHService.removeSession(session.id)
  vi.restoreAllMocks()
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

interface Terminal {
  ws: WebSocket
  /** Resolves with the next decoded output chunk. */
  nextOutput: () => Promise<string>
  send: (text: string) => void
}

/** Opens a terminal the way TerminalPane does: `/ws/terminal/<id>?token=<jwt>`. */
function openTerminal(sessionId: string): Promise<Terminal> {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${wsPort}/ws/terminal/${sessionId}?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    sockets.push(ws)
    const outputs: string[] = []
    const waiters: ((text: string) => void)[] = []
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'status' && msg.state === 'connected') {
        resolve({
          ws,
          send: (text) =>
            ws.send(JSON.stringify({ type: 'input', data: Buffer.from(text).toString('base64') })),
          nextOutput: () =>
            outputs.length > 0
              ? Promise.resolve(outputs.shift() as string)
              : new Promise((r) => waiters.push(r))
        })
      } else if (msg.type === 'output') {
        const text = Buffer.from(msg.data, 'base64').toString('utf8')
        const waiter = waiters.shift()
        if (waiter) waiter(text)
        else outputs.push(text)
      }
    })
    ws.on('close', (code, reason) =>
      reject(new Error(`terminal closed before connecting: ${code} ${reason.toString()}`))
    )
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

async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

describe('[FR-02.1][BL-11] terminal WebSocket', () => {
  it('attaches through the real URL (with ?token=) and relays input and output', async () => {
    const sessionId = await connect()
    const terminal = await openTerminal(sessionId)
    terminal.send('hello')
    expect(await terminal.nextOutput()).toBe('hello')
    expect(consumersOf(sessionId)).toBe(1)
  })
})

describe('[FR-03.5][BL-11] consumer-aware reaping', () => {
  it('never reaps a session with an open terminal, however long it idles', async () => {
    const sessionId = await connect()
    await openTerminal(sessionId)

    const reaped = SSHService.reapIdleSessions(Date.now() + 10 * 60_000)

    expect(reaped).toEqual([])
    expect(SSHService.getSession(sessionId)).toBeDefined()
  })

  it('reaps a session with no consumers and no heartbeat after 60 s', async () => {
    const sessionId = await connect()
    expect(SSHService.reapIdleSessions(Date.now() + 30_000)).toEqual([])
    expect(SSHService.reapIdleSessions(Date.now() + 61_000)).toEqual([sessionId])

    const status = await request(app)
      .get(`/api/sessions/${sessionId}`)
      .set(...auth())
    expect(status.body).toEqual({ alive: false })
  })

  it('a heartbeat from an open tab renews the lease', async () => {
    const sessionId = await connect()
    const t0 = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 50_000)
    expect(SSHService.heartbeat(sessionId)).toBe(true)
    vi.restoreAllMocks()

    // 100 s after connect, but only 50 s after the heartbeat.
    expect(SSHService.reapIdleSessions(t0 + 100_000)).toEqual([])
    expect(SSHService.reapIdleSessions(t0 + 111_000)).toEqual([sessionId])
  })

  it('GET /api/sessions/:id reports alive and renews the lease', async () => {
    const sessionId = await connect()
    const res = await request(app)
      .get(`/api/sessions/${sessionId}`)
      .set(...auth())
    expect(res.body).toEqual({ alive: true })

    const list = await request(app)
      .get('/api/sessions')
      .set(...auth())
    expect(list.body.sessions).toEqual([
      expect.objectContaining({ id: sessionId, profileId, consumers: 0 })
    ])
  })

  it('a running tunnel holds the session until it is stopped', async () => {
    const sessionId = await connect()
    const port = await freePort()
    await TunnelService.startLocalForward(sessionId, port, '127.0.0.1', 9)
    expect(consumersOf(sessionId)).toBe(1)
    expect(SSHService.reapIdleSessions(Date.now() + 10 * 60_000)).toEqual([])

    await TunnelService.stopLocalForward(sessionId, port)
    expect(consumersOf(sessionId)).toBe(0)
  })
})

describe('[FR-02.8][BL-11] closing a terminal', () => {
  it('closes only its own shell — the session and other terminals keep working', async () => {
    const sessionId = await connect()
    const first = await openTerminal(sessionId)
    const second = await openTerminal(sessionId)
    expect(consumersOf(sessionId)).toBe(2)

    first.ws.close()
    await waitFor(() => consumersOf(sessionId) === 1)

    second.send('still here')
    expect(await second.nextOutput()).toBe('still here')
    expect(SSHService.getSession(sessionId)).toBeDefined()
  })
})
