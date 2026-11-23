/**
 * [FR-08.2][FR-08.5][FR-08.6][BL-32] The audit log records one disconnect entry
 * per session with its reason, pages and filters on the server, and exports
 * CSV that spreadsheets cannot run as formulas.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { trustTestServer } from './helpers/knownHosts'
import { SSHService } from '../../backend/src/services/ssh.service'
import { csvField } from '../../backend/src/services/audit.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let sshServer: TestSshServer
let profileId: string

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
  const profile = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name: 'Audit host',
      host: sshServer.host,
      port: sshServer.port,
      username: sshServer.username,
      authMethod: 'password',
      password: sshServer.password
    })
  profileId = profile.body.id
})

afterEach(async () => {
  for (const session of SSHService.listSessions()) SSHService.removeSession(session.id)
  await waitFor(async () => SSHService.listSessions().length === 0)
  await prisma.auditLog.deleteMany()
})

afterAll(async () => {
  await sshServer.close()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 25))
  }
}

async function connect(): Promise<string> {
  const res = await request(app)
    .post(`/api/profiles/${profileId}/connect`)
    .set(...auth())
  expect(res.status).toBe(200)
  return res.body.sessionId
}

const disconnects = (): Promise<
  { detail: string; success: boolean; errorMessage: string | null }[]
> => prisma.auditLog.findMany({ where: { type: 'disconnection' } })

/** Waits for the (asynchronous) log write, then returns all disconnect entries. */
async function disconnectEntries(): Promise<Awaited<ReturnType<typeof disconnects>>> {
  await waitFor(async () => (await disconnects()).length > 0)
  await new Promise((r) => setTimeout(r, 150)) // a stray second entry would land by now
  return disconnects()
}

describe('[FR-08.2][BL-32] disconnect reasons', () => {
  it('records "closed by user" when the session is closed through the API', async () => {
    const sessionId = await connect()
    await request(app)
      .delete(`/api/sessions/${sessionId}`)
      .set(...auth())

    const entries = await disconnectEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].detail).toBe('Disconnected: closed by user')
    expect(entries[0].success).toBe(true)
  })

  it('records "idle timeout" when the reaper closes it', async () => {
    await connect()
    SSHService.reapIdleSessions(Date.now() + 61_000)

    const entries = await disconnectEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].detail).toBe('Disconnected: idle timeout')
  })

  it('records "closed by remote" when the server hangs up', async () => {
    await connect()
    await sshServer.disconnectClients()

    const entries = await disconnectEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].detail).toBe('Disconnected: closed by remote')
  })

  it('an error after connecting writes ONE disconnect entry with the error, and no failed connection', async () => {
    const sessionId = await connect()
    const session = SSHService.getSession(sessionId)!
    session.client.emit('error', new Error('keepalive timeout'))
    session.client.destroy()

    const entries = await disconnectEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      detail: 'Disconnected: connection error',
      success: false,
      errorMessage: 'keepalive timeout'
    })
    const failedConnections = await prisma.auditLog.count({
      where: { type: 'connection', success: false }
    })
    expect(failedConnections).toBe(0)
  })

  it('a refused login is a single failed connection and no disconnect entry', async () => {
    const bad = await request(app)
      .post('/api/profiles')
      .set(...auth())
      .send({
        name: 'Bad login',
        host: sshServer.host,
        port: sshServer.port,
        username: sshServer.username,
        authMethod: 'password',
        password: 'nope'
      })
    const res = await request(app)
      .post(`/api/profiles/${bad.body.id}/connect`)
      .set(...auth())
    expect(res.status).toBe(500)

    await waitFor(async () => (await prisma.auditLog.count()) > 0)
    await new Promise((r) => setTimeout(r, 150))
    expect(await prisma.auditLog.count({ where: { type: 'connection', success: false } })).toBe(1)
    expect(await disconnects()).toHaveLength(0)
  })
})

describe('[FR-08.5][BL-32] paging and filtering on the server', () => {
  async function seed(): Promise<void> {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      type: i % 5 === 0 ? 'disconnection' : 'sftp_upload',
      detail: i % 5 === 0 ? `Disconnected: closed by user #${i}` : `Uploaded file-${i}.txt`,
      profileName: i % 2 === 0 ? 'Alpha' : 'Beta',
      success: true,
      timestamp: new Date(Date.UTC(2026, 10, 1, 0, i)) // one per minute, newest = i 24
    }))
    await prisma.auditLog.createMany({ data: rows })
  }

  it('pages newest first and reports the total', async () => {
    await seed()
    const first = await request(app)
      .get('/api/audit?page=1&pageSize=10')
      .set(...auth())
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ total: 25, page: 1, pageSize: 10 })
    expect(first.body.items).toHaveLength(10)

    const last = await request(app)
      .get('/api/audit?page=3&pageSize=10')
      .set(...auth())
    expect(last.body.items).toHaveLength(5)
    const times = [...first.body.items, ...last.body.items].map(
      (i: { timestamp: string }) => i.timestamp
    )
    expect([...times].sort().reverse()).toEqual(times) // strictly newest first across pages
  })

  it('filters by type, and total is the filtered count', async () => {
    await seed()
    const res = await request(app)
      .get('/api/audit?type=disconnection&pageSize=50')
      .set(...auth())
    expect(res.body.total).toBe(5)
    expect(res.body.items.every((i: { type: string }) => i.type === 'disconnection')).toBe(true)
  })

  it('filters by date range', async () => {
    await seed()
    const from = new Date(Date.UTC(2026, 10, 1, 0, 10)).toISOString()
    const to = new Date(Date.UTC(2026, 10, 1, 0, 14)).toISOString()
    const res = await request(app)
      .get('/api/audit')
      .query({ from, to })
      .set(...auth())
    expect(res.body.total).toBe(5) // minutes 10..14 inclusive
  })

  it('searches detail and profile name', async () => {
    await seed()
    const byDetail = await request(app)
      .get('/api/audit')
      .query({ q: 'file-7.txt' })
      .set(...auth())
    expect(byDetail.body.total).toBe(1)
    const byProfile = await request(app)
      .get('/api/audit')
      .query({ q: 'alpha' })
      .set(...auth())
    expect(byProfile.body.total).toBe(13) // even indexes 0..24
  })

  it('rejects bad parameters with 400', async () => {
    for (const query of ['page=0', 'pageSize=500', 'type=nope', 'from=yesterday-ish']) {
      const res = await request(app)
        .get(`/api/audit?${query}`)
        .set(...auth())
      expect(res.status, query).toBe(400)
    }
  })
})

describe('[FR-08.6][BL-32] CSV formula safety', () => {
  it.each(['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx'])(
    '%j is neutralised with a leading quote',
    (value) => {
      expect(csvField(value)).toBe(`"'${value}"`)
    }
  )

  it('leaves ordinary values alone and still doubles quotes', () => {
    expect(csvField('plain')).toBe('"plain"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField(null)).toBe('""')
  })

  it('the export applies it to an entry planted by a remote server', async () => {
    await prisma.auditLog.create({
      data: {
        type: 'connection',
        detail: 'Connection failed',
        success: false,
        errorMessage: '=HYPERLINK("http://evil.example","click")'
      }
    })
    const res = await request(app)
      .get('/api/audit/export')
      .set(...auth())
    expect(res.status).toBe(200)
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`)
    expect(res.text).not.toMatch(/,"=HYPERLINK/)
  })
})
