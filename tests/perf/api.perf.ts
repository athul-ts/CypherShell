/**
 * [NFR-01][BL-45] Measures the backend half of the NFR-01 targets against the in-process SSH
 * server and writes each value to perf-results/. Hard gates fail the run when exceeded.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import type { Express } from 'express'
import { createApp, launch, TEST_LAUNCH_SECRET } from '../backend/helpers/createApp'
import { startTestSshServer, type TestSshServer } from '../backend/helpers/sshServer'
import { trustTestServer } from '../backend/helpers/knownHosts'
import { setupTerminalWebSocket } from '../../backend/src/websocket/terminal.ws'
import { SSHService } from '../../backend/src/services/ssh.service'
import { AuditService } from '../../backend/src/services/audit.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'
import { enforce, median, percentile, record } from './record'

let app: Express
let token: string
let httpServer: Server
let wsPort: number
let ssh: TestSshServer
let sftpSsh: TestSshServer
let profileId: string
let sftpProfileId: string
const sockets: WebSocket[] = []

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]
const ms = (start: bigint): number => Number(process.hrtime.bigint() - start) / 1e6

async function createProfile(server: TestSshServer, name: string): Promise<string> {
  const res = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name,
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: 'password',
      password: server.password
    })
  expect(res.status).toBe(201)
  return res.body.id
}

async function connect(id: string): Promise<string> {
  const res = await request(app)
    .post(`/api/profiles/${id}/connect`)
    .set(...auth())
    .send({})
  expect(res.status).toBe(200)
  return res.body.sessionId
}

/** A terminal that resolves `echo(text)` when the shell has sent the text back. */
interface Terminal {
  echo: (text: string) => Promise<void>
}

function openTerminal(sessionId: string): Promise<Terminal> {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${wsPort}/ws/terminal/${sessionId}?token=${encodeURIComponent(token)}&launch=${TEST_LAUNCH_SECRET}`
    const ws = new WebSocket(url)
    sockets.push(ws)
    let waiting: { text: string; done: () => void } | null = null
    let buffer = ''
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'status' && msg.state === 'connected') {
        resolve({
          echo: (text) =>
            new Promise<void>((done) => {
              buffer = ''
              waiting = { text, done }
              ws.send(JSON.stringify({ type: 'input', data: Buffer.from(text).toString('base64') }))
            })
        })
      } else if (msg.type === 'output') {
        buffer += Buffer.from(msg.data, 'base64').toString('utf8')
        if (waiting && buffer.includes(waiting.text)) {
          const { done } = waiting
          waiting = null
          done()
        }
      }
    })
    ws.on('error', reject)
  })
}

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

  ssh = await startTestSshServer()
  sftpSsh = await startTestSshServer({ sftpEntries: 1000 })
  await trustTestServer(ssh)
  await trustTestServer(sftpSsh)
  profileId = await createProfile(ssh, 'Perf host')
  sftpProfileId = await createProfile(sftpSsh, 'Perf SFTP host')

  httpServer = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()))
  setupTerminalWebSocket(httpServer)
  wsPort = (httpServer.address() as AddressInfo).port
})

afterAll(async () => {
  for (const ws of sockets.splice(0)) ws.close()
  for (const s of SSHService.listSessions()) SSHService.removeSession(s.id)
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  await ssh.close()
  await sftpSsh.close()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('[NFR-01] backend performance', () => {
  it('terminal input-to-display: p95 of 200 echoes under 50 ms', async () => {
    const terminal = await openTerminal(await connect(profileId))
    await terminal.echo('w') // warm-up: the first keystroke pays for JIT and socket set-up

    const samples: number[] = []
    for (let i = 0; i < 200; i++) {
      const start = process.hrtime.bigint()
      await terminal.echo('x')
      samples.push(ms(start))
    }
    const p95 = percentile(samples, 95)
    enforce(
      record('terminal-latency', p95, 'ms', 50, 'hard', `median ${median(samples).toFixed(2)} ms`)
    )
  })

  it('profile list: 100 profiles, median of 20 under 200 ms', async () => {
    await prisma.profile.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        name: `Bulk ${String(i).padStart(3, '0')}`,
        host: `10.0.${Math.floor(i / 250)}.${i % 250}`,
        port: 22,
        username: 'user',
        authMethod: 'password'
      }))
    })
    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      const start = process.hrtime.bigint()
      const res = await request(app)
        .get('/api/profiles')
        .set(...auth())
      samples.push(ms(start))
      expect(res.body.length).toBeGreaterThanOrEqual(100)
    }
    enforce(record('profile-list', median(samples), 'ms', 200, 'hard'))
  })

  it('SFTP listing: 1000 entries under 2 s (first call, including opening the channel)', async () => {
    const sessionId = await connect(sftpProfileId)
    const start = process.hrtime.bigint()
    const res = await request(app)
      .get(`/api/sftp/${sessionId}/list`)
      .query({ path: '/data', showHidden: 'true' })
      .set(...auth())
    const elapsed = ms(start)
    expect(res.status).toBe(200)
    expect(res.body.files).toHaveLength(1000)
    enforce(record('sftp-listing', elapsed, 'ms', 2000, 'hard'))
  })

  it('20 concurrent sessions: every shell echoes', async () => {
    for (const s of SSHService.listSessions()) SSHService.removeSession(s.id)
    for (const ws of sockets.splice(0)) ws.close()
    const rssBefore = process.memoryUsage().rss

    const terminals: Terminal[] = []
    for (let i = 0; i < 20; i++) terminals.push(await openTerminal(await connect(profileId)))
    const results = await Promise.allSettled(
      terminals.map((t, i) =>
        Promise.race([
          t.echo(`s${i}`),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('no echo')), 5000))
        ])
      )
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    const rssMb = (process.memoryUsage().rss - rssBefore) / (1024 * 1024)

    record(
      'concurrent-sessions-memory',
      rssMb,
      'MB',
      200,
      'info',
      'resident memory growth with 20 sessions'
    )
    expect(SSHService.listSessions()).toHaveLength(20)
    enforce(record('concurrent-sessions', failed, 'sessions without echo (of 20)', 1, 'hard'))
  })

  it('SQLite: audit page over 10 000 rows, profile list and key list under 50 ms', async () => {
    const base = Date.now()
    for (let chunk = 0; chunk < 10; chunk++) {
      await prisma.auditLog.createMany({
        data: Array.from({ length: 1000 }, (_, i) => {
          const n = chunk * 1000 + i
          return {
            type: n % 3 === 0 ? 'connection' : n % 3 === 1 ? 'disconnection' : 'sftp_upload',
            profileName: `Host ${n % 50}`,
            host: `10.1.${n % 250}.1`,
            detail: n % 3 === 0 ? 'Connected successfully' : `Entry ${n}`,
            success: true,
            timestamp: new Date(base - n * 1000)
          }
        })
      })
    }
    await prisma.sSHKey.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        name: `Key ${i}`,
        keyType: 'ed25519',
        encryptedPrivateKey: 'x'.repeat(400),
        publicKey: 'ssh-ed25519 AAAA',
        fingerprint: `SHA256:${i}`
      }))
    })

    async function time(run: () => Promise<unknown>): Promise<number> {
      await run() // warm-up
      const samples: number[] = []
      for (let i = 0; i < 20; i++) {
        const start = process.hrtime.bigint()
        await run()
        samples.push(ms(start))
      }
      return median(samples)
    }

    const audit = await time(() =>
      AuditService.queryLogs({ page: 3, pageSize: 50, type: 'connection', q: 'Connected' })
    )
    const profiles = await time(() => prisma.profile.findMany({ orderBy: { name: 'asc' } }))
    const keys = await time(() => prisma.sSHKey.findMany({ orderBy: { createdAt: 'desc' } }))

    const results = [
      record('sqlite-audit-page', audit, 'ms', 50, 'hard', '10 000 rows, filtered, page 3'),
      record('sqlite-profile-list', profiles, 'ms', 50, 'hard'),
      record('sqlite-key-list', keys, 'ms', 50, 'hard')
    ]
    results.forEach(enforce)
  })
})
