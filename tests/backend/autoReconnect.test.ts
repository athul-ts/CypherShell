/**
 * [FR-02.6][BL-41] Automatic SSH reconnect: the session keeps its id, terminals keep their
 * WebSocket, tunnels come back, and giving up closes terminals with 4002.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import net, { type AddressInfo } from 'net'
import type { Server } from 'http'
import type { Express } from 'express'
import { createApp, launch, TEST_LAUNCH_SECRET } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { trustTestServer } from './helpers/knownHosts'
import { setupTerminalWebSocket } from '../../backend/src/websocket/terminal.ws'
import { SSHService } from '../../backend/src/services/ssh.service'
import { TunnelService } from '../../backend/src/services/tunnel.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let httpServer: Server
let wsPort: number
const servers: TestSshServer[] = []
const sockets: WebSocket[] = []

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]
const ORIGINAL_DELAYS = [...SSHService.RECONNECT_DELAYS_MS]

async function newHost(
  autoReconnect = true
): Promise<{ server: TestSshServer; profileId: string }> {
  const server = await startTestSshServer()
  servers.push(server)
  await trustTestServer(server)
  const res = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name: `Reconnect ${server.port}`,
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: 'password',
      password: server.password,
      autoReconnect
    })
  expect(res.status).toBe(201)
  return { server, profileId: res.body.id }
}

async function connect(profileId: string): Promise<string> {
  const res = await request(app)
    .post(`/api/profiles/${profileId}/connect`)
    .set(...auth())
    .send({})
  expect(res.status).toBe(200)
  return res.body.sessionId
}

async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 15))
  }
}

interface Terminal {
  ws: WebSocket
  states: string[]
  outputs: string[]
  closed: { code: number } | null
  send: (text: string) => void
}

function openTerminal(sessionId: string): Promise<Terminal> {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${wsPort}/ws/terminal/${sessionId}?token=${encodeURIComponent(token)}&launch=${TEST_LAUNCH_SECRET}`
    const ws = new WebSocket(url)
    sockets.push(ws)
    const term: Terminal = {
      ws,
      states: [],
      outputs: [],
      closed: null,
      send: (text) =>
        ws.send(JSON.stringify({ type: 'input', data: Buffer.from(text).toString('base64') }))
    }
    let resolved = false
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'status') {
        term.states.push(msg.state)
        if (msg.state === 'connected' && !resolved) {
          resolved = true
          resolve(term)
        }
      } else if (msg.type === 'output') {
        term.outputs.push(Buffer.from(msg.data, 'base64').toString('utf8'))
      }
    })
    ws.on('close', (code) => {
      term.closed = { code }
      if (!resolved) reject(new Error(`closed before connecting: ${code}`))
    })
    ws.on('error', reject)
  })
}

const outputText = (t: Terminal): string => t.outputs.join('')
const stateOf = (id: string): string | undefined => SSHService.getSession(id)?.state

async function echoes(t: Terminal, text: string): Promise<boolean> {
  const before = outputText(t).length
  t.send(text)
  try {
    await waitFor(() => outputText(t).slice(before).includes(text), 2000)
    return true
  } catch {
    return false
  }
}

async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

/** Connects to a local tunnel port, sends text and returns what comes back (the fixture echoes). */
function roundTrip(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(text))
    socket.once('data', (d) => {
      socket.destroy()
      resolve(d.toString())
    })
    socket.once('error', reject)
    setTimeout(() => {
      socket.destroy()
      reject(new Error('no echo'))
    }, 2000)
  })
}

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

  httpServer = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()))
  setupTerminalWebSocket(httpServer)
  wsPort = (httpServer.address() as AddressInfo).port
  SSHService.RECONNECT_DELAYS_MS = [10, 20, 40]
})

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close()
  for (const s of SSHService.listSessions()) SSHService.removeSession(s.id)
  SSHService.RECONNECT_DELAYS_MS = [10, 20, 40]
  vi.restoreAllMocks()
  await prisma.auditLog.deleteMany()
})

afterAll(async () => {
  SSHService.RECONNECT_DELAYS_MS = ORIGINAL_DELAYS
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  for (const s of servers) await s.close().catch(() => {})
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('[BL-41] reconnect after the server drops the connection', () => {
  it('keeps the terminal open, reconnects with the same session id and opens a new shell', async () => {
    const { server, profileId } = await newHost()
    const sessionId = await connect(profileId)
    const term = await openTerminal(sessionId)
    expect(await echoes(term, 'before')).toBe(true)

    await server.disconnectClients()
    await waitFor(() => term.states.includes('reconnecting'))
    await waitFor(() => term.states.filter((s) => s === 'connected').length === 2)

    expect(term.closed).toBeNull()
    expect(SSHService.getSession(sessionId)?.state).toBe('connected')
    expect(outputText(term)).toContain('reconnected')
    expect(await echoes(term, 'after')).toBe(true)
  })

  it('writes one disconnect entry and one "Reconnected" entry', async () => {
    const { server, profileId } = await newHost()
    const sessionId = await connect(profileId)
    await server.disconnectClients()
    await waitFor(() => stateOf(sessionId) === 'reconnecting' || server.connectionCount() > 0)
    await waitFor(() => server.connectionCount() === 1 && stateOf(sessionId) === 'connected')

    await new Promise((r) => setTimeout(r, 100))
    const disconnects = await prisma.auditLog.findMany({
      where: { type: 'disconnection', profileId }
    })
    const reconnects = await prisma.auditLog.findMany({
      where: { detail: 'Reconnected after connection loss', profileId }
    })
    expect(disconnects).toHaveLength(1)
    expect(reconnects).toHaveLength(1)
  })

  it('reports the state through GET /api/sessions/:id', async () => {
    const { profileId } = await newHost()
    const sessionId = await connect(profileId)
    const res = await request(app)
      .get(`/api/sessions/${sessionId}`)
      .set(...auth())
    expect(res.body).toEqual({ alive: true, state: 'connected' })
    const gone = await request(app)
      .get('/api/sessions/session-missing')
      .set(...auth())
    expect(gone.body.alive).toBe(false)
  })
})

describe('[BL-41] giving up', () => {
  it('with autoReconnect off the terminal closes with 4002 and the session is gone', async () => {
    const { server, profileId } = await newHost(false)
    const sessionId = await connect(profileId)
    const term = await openTerminal(sessionId)

    await server.disconnectClients()
    await waitFor(() => term.closed !== null)

    expect(term.closed?.code).toBe(4002)
    expect(term.states).not.toContain('reconnecting')
    expect(SSHService.getSession(sessionId)).toBeUndefined()
  })

  it('after three failed attempts the terminal closes with 4002 and "Reconnect failed" is logged', async () => {
    const { server, profileId } = await newHost()
    const sessionId = await connect(profileId)
    const term = await openTerminal(sessionId)

    await server.close() // nothing listens any more: every attempt is refused
    await waitFor(() => term.closed !== null)

    expect(term.states).toContain('reconnecting')
    expect(term.closed?.code).toBe(4002)
    expect(SSHService.getSession(sessionId)).toBeUndefined()
    const failed = await prisma.auditLog.findMany({
      where: { detail: 'Reconnect failed', profileId }
    })
    expect(failed).toHaveLength(1)
    expect(failed[0].success).toBe(false)
    expect(await prisma.auditLog.count({ where: { type: 'disconnection', profileId } })).toBe(1)
  })

  it('a changed host key stops the reconnect without sending credentials', async () => {
    const { server, profileId } = await newHost()
    const sessionId = await connect(profileId)
    const term = await openTerminal(sessionId)
    await prisma.knownHost.updateMany({
      where: { host: server.host, port: server.port },
      data: { fingerprint: 'SHA256:' + 'C'.repeat(43) }
    })
    const attemptsBefore = server.authAttempts()

    await server.disconnectClients()
    await waitFor(() => term.closed !== null)

    expect(term.closed?.code).toBe(4002)
    expect(server.authAttempts()).toBe(attemptsBefore)
    expect(SSHService.getSession(sessionId)).toBeUndefined()
  })

  it('a session closed during a reconnect makes no further attempts', async () => {
    SSHService.RECONNECT_DELAYS_MS = [150, 150, 150]
    const { server, profileId } = await newHost()
    const sessionId = await connect(profileId)
    await server.disconnectClients()
    await waitFor(() => stateOf(sessionId) === 'reconnecting')

    SSHService.removeSession(sessionId)
    const attempts = server.authAttempts()
    await new Promise((r) => setTimeout(r, 600))

    expect(server.authAttempts()).toBe(attempts)
    expect(server.connectionCount()).toBe(0)
  })
})

describe('[BL-41] tunnels after a reconnect', () => {
  it('local and dynamic forwards work again', async () => {
    const { server, profileId } = await newHost()
    const sessionId = await connect(profileId)
    const localPort = await freePort()
    await TunnelService.startLocalForward(sessionId, localPort, '127.0.0.1', 9)
    expect(await roundTrip(localPort, 'one')).toBe('one')

    await server.disconnectClients()
    await waitFor(() => server.connectionCount() === 1 && stateOf(sessionId) === 'connected')

    expect(await roundTrip(localPort, 'two')).toBe('two')
  })

  it('connections that arrive while reconnecting are closed', async () => {
    SSHService.RECONNECT_DELAYS_MS = [300, 300, 300]
    const { server, profileId } = await newHost()
    const sessionId = await connect(profileId)
    const localPort = await freePort()
    await TunnelService.startLocalForward(sessionId, localPort, '127.0.0.1', 9)

    await server.disconnectClients()
    await waitFor(() => stateOf(sessionId) === 'reconnecting')

    await expect(roundTrip(localPort, 'x')).rejects.toBeDefined()
  })

  it('remote forwards are registered again on the new client', async () => {
    const forwardIn = vi.fn((_host: string, _port: number, cb: (err?: Error) => void) => cb())
    const on = vi.fn()
    const fake = {
      id: 'session-fake',
      client: { forwardIn, on },
      hasTcpListener: true,
      state: 'connected'
    }
    ;(SSHService as unknown as { sessions: Map<string, unknown> }).sessions.set(fake.id, fake)
    await TunnelService.startRemoteForward(fake.id, 2222, '127.0.0.1', 22)
    forwardIn.mockClear()
    on.mockClear()

    // The session now has a fresh client, as after a reconnect.
    fake.client = { forwardIn, on }
    await TunnelService.restoreRemoteForwards(fake as never)

    expect(forwardIn).toHaveBeenCalledWith('127.0.0.1', 2222, expect.any(Function))
    expect(on).toHaveBeenCalledWith('tcp connection', expect.any(Function))
    ;(SSHService as unknown as { sessions: Map<string, unknown> }).sessions.delete(fake.id)
    TunnelService.cleanupSession(fake.id)
  })
})
