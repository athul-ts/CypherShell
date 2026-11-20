/**
 * [NFR-02][BL-23] SFTP, tunnel and config requests are validated before they
 * reach the services.
 *
 * Regressions covered:
 *  - `transferId` was used raw as an EventEmitter event name: "error" made
 *    the first progress event throw inside an ssh2 callback and killed the
 *    backend.
 *  - The local path went straight to fastPut/fastGet (relative paths,
 *    directories, devices).
 *  - Tunnel and config bodies were unvalidated.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import net, { type AddressInfo } from 'net'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { trustTestServer } from './helpers/knownHosts'
import { SSHService } from '../../backend/src/services/ssh.service'
import { TunnelService } from '../../backend/src/services/tunnel.service'
import { LocalPathError, LocalPathService } from '../../backend/src/services/local-path.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let sshServer: TestSshServer
let profileId: string
let tempDir: string

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
      name: 'Validation host',
      host: sshServer.host,
      port: sshServer.port,
      username: sshServer.username,
      authMethod: 'password',
      password: sshServer.password
    })
  profileId = profile.body.id
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-validation-'))
})

afterEach(() => {
  for (const session of SSHService.listSessions()) SSHService.removeSession(session.id)
})

afterAll(async () => {
  await sshServer.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
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

/** An SFTP channel whose transfers never finish, so a transfer stays "in progress". */
class StalledChannel extends EventEmitter {
  fastPut(): void {
    /* no-op fake */
  }
  fastGet(): void {
    /* no-op fake */
  }
  unlink(_p: string, cb: () => void): void {
    cb()
  }
  destroy(): void {
    this.emit('close')
  }
  end(): void {
    this.destroy()
  }
}

async function connectWithStalledSftp(): Promise<string> {
  const sessionId = await connect()
  const session = SSHService.getSession(sessionId)!
  ;(
    session.client as unknown as {
      sftp: (cb: (err: Error | undefined, s: unknown) => void) => void
    }
  ).sftp = (cb) => cb(undefined, new StalledChannel())
  return sessionId
}

const BAD_TRANSFER_IDS = [
  'error',
  'newListener',
  '__proto__',
  'up-ABC',
  'up-',
  'up-a b',
  'x'.repeat(40)
]

describe('[BL-23] transferId format', () => {
  it.each(BAD_TRANSFER_IDS)('refuses %j on upload, download, progress and cancel', async (id) => {
    const upload = await request(app)
      .post('/api/sftp/any/upload')
      .set(...auth())
      .send({ localPath: __filename, remotePath: '/tmp/x', transferId: id })
    expect(upload.status).toBe(400)

    const download = await request(app)
      .post('/api/sftp/any/download')
      .set(...auth())
      .send({ localPath: path.join(tempDir, 'x'), remotePath: '/tmp/x', transferId: id })
    expect(download.status).toBe(400)

    const progress = await request(app).get(
      `/api/sftp/any/progress/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`
    )
    expect(progress.status).toBe(400)

    const cancel = await request(app)
      .delete(`/api/sftp/any/transfer/${encodeURIComponent(id)}`)
      .set(...auth())
    expect(cancel.status).toBe(400)
  })

  it('refuses an upload id on a download and a download id on an upload', async () => {
    const upload = await request(app)
      .post('/api/sftp/any/upload')
      .set(...auth())
      .send({ localPath: __filename, remotePath: '/tmp/x', transferId: 'dn-abc' })
    expect(upload.status).toBe(400)
    const download = await request(app)
      .post('/api/sftp/any/download')
      .set(...auth())
      .send({ localPath: path.join(tempDir, 'x'), remotePath: '/tmp/x', transferId: 'up-abc' })
    expect(download.status).toBe(400)
  })

  it('keeps running after an attempt with transferId "error"', async () => {
    const sessionId = await connectWithStalledSftp()
    const res = await request(app)
      .post(`/api/sftp/${sessionId}/upload`)
      .set(...auth())
      .send({ localPath: __filename, remotePath: '/tmp/x', transferId: 'error' })
    expect(res.status).toBe(400)
    expect((await request(app).get('/api/health')).status).toBe(200)
  })

  it('refuses a second transfer with an id that is still in progress', async () => {
    const sessionId = await connectWithStalledSftp()
    const body = { localPath: __filename, remotePath: '/tmp/dup', transferId: 'up-dup1' }
    const first = await request(app)
      .post(`/api/sftp/${sessionId}/upload`)
      .set(...auth())
      .send(body)
    expect(first.status).toBe(200)
    const second = await request(app)
      .post(`/api/sftp/${sessionId}/upload`)
      .set(...auth())
      .send(body)
    expect(second.status).toBe(409)

    const cancel = await request(app)
      .delete(`/api/sftp/${sessionId}/transfer/up-dup1`)
      .set(...auth())
    expect(cancel.status).toBe(200)
  })
})

describe('[BL-23] local paths', () => {
  it('refuses relative, missing and directory upload sources', async () => {
    for (const localPath of ['relative/file.txt', path.join(tempDir, 'missing.txt'), tempDir]) {
      const res = await request(app)
        .post('/api/sftp/any/upload')
        .set(...auth())
        .send({ localPath, remotePath: '/tmp/x', transferId: 'up-path1' })
      expect(res.status).toBe(400)
    }
  })

  it('refuses a download into a missing folder or onto a folder', async () => {
    for (const localPath of [path.join(tempDir, 'nope', 'file.txt'), tempDir]) {
      const res = await request(app)
        .post('/api/sftp/any/download')
        .set(...auth())
        .send({ localPath, remotePath: '/tmp/x', transferId: 'dn-path1' })
      expect(res.status).toBe(400)
    }
  })

  it('accepts any absolute folder the dialogs can pick, and normalizes the path', async () => {
    const file = path.join(tempDir, 'source.txt')
    fs.writeFileSync(file, 'hello')
    const unnormalized = path.join(tempDir, 'sub', '..', 'source.txt')
    expect(await LocalPathService.uploadSource(unnormalized)).toBe(file)
    expect(await LocalPathService.downloadTarget(path.join(tempDir, 'new.txt'))).toBe(
      path.join(tempDir, 'new.txt')
    )
    expect(await LocalPathService.downloadTarget(file)).toBe(file) // replacing a file is fine
  })

  it('refuses NUL bytes', async () => {
    await expect(LocalPathService.uploadSource(`${tempDir}${path.sep}a\0b`)).rejects.toThrow(
      LocalPathError
    )
  })
})

describe('[BL-23] remote paths and chmod', () => {
  it('refuses empty or malformed remote paths and modes', async () => {
    const cases: [string, object][] = [
      ['delete', { remotePath: '' }],
      ['mkdir', { remotePath: 42 }],
      ['rename', { oldPath: '/a', newPath: 'b\0c' }],
      ['chmod', { remotePath: '/a', mode: '999' }],
      ['chmod', { remotePath: '/a', mode: 0o17777 }]
    ]
    for (const [op, body] of cases) {
      const res = await request(app)
        .post(`/api/sftp/any/${op}`)
        .set(...auth())
        .send(body)
      expect(res.status).toBe(400)
    }
    const list = await request(app)
      .get('/api/sftp/any/list')
      .query({ path: ['a', 'b'] })
      .set(...auth())
    expect(list.status).toBe(400)
  })
})

async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

describe('[BL-23] tunnel bodies', () => {
  it('refuses unknown types, bad ports and a local forward without a host', async () => {
    const bad = [
      { type: 'bogus', localPort: '8080' },
      { type: 'local', localPort: 'abc', remoteHost: 'db', remotePort: '5432' },
      { type: 'local', localPort: 0, remoteHost: 'db', remotePort: 5432 },
      { type: 'local', localPort: 70000, remoteHost: 'db', remotePort: 5432 },
      { type: 'local', localPort: '8080', remotePort: '5432' },
      { type: 'local', localPort: '8080', remoteHost: 'bad host', remotePort: '5432' },
      { type: 'dynamic', localPort: '' }
    ]
    for (const body of bad) {
      const res = await request(app)
        .post('/api/tunnels/any/start')
        .set(...auth())
        .send(body)
      expect(res.status).toBe(400)
    }
    const stop = await request(app)
      .post('/api/tunnels/any/stop')
      .set(...auth())
      .send({ type: 'dynamic', port: '' })
    expect(stop.status).toBe(400)
  })

  it('accepts the payloads the Profile Details form sends (string ports) and stops a dynamic tunnel', async () => {
    const sessionId = await connect()
    const localPort = String(await freePort())
    const start = await request(app)
      .post(`/api/tunnels/${sessionId}/start`)
      .set(...auth())
      .send({ type: 'dynamic', localPort, remoteHost: '127.0.0.1', remotePort: '' })
    expect(start.status).toBe(200)
    expect(await TunnelService.checkPort(Number(localPort))).toBe(false)

    const stop = await request(app)
      .post(`/api/tunnels/${sessionId}/stop`)
      .set(...auth())
      .send({ type: 'dynamic', port: localPort })
    expect(stop.status).toBe(200)
    // The listening socket closes asynchronously.
    const deadline = Date.now() + 3000
    while (!(await TunnelService.checkPort(Number(localPort)))) {
      if (Date.now() > deadline) throw new Error(`port ${localPort} still in use after stop`)
      await new Promise((r) => setTimeout(r, 20))
    }
  })

  it('accepts a local forward with string ports', async () => {
    const sessionId = await connect()
    const localPort = String(await freePort())
    const start = await request(app)
      .post(`/api/tunnels/${sessionId}/start`)
      .set(...auth())
      .send({ type: 'local', localPort, remoteHost: '127.0.0.1', remotePort: '7' })
    expect(start.status).toBe(200)
    const stop = await request(app)
      .post(`/api/tunnels/${sessionId}/stop`)
      .set(...auth())
      .send({ type: 'local', port: localPort })
    expect(stop.status).toBe(200)
  })
})

describe('[BL-23] config bodies', () => {
  it.each([
    { theme: 'neon' },
    { defaultFontSize: 'big' },
    { defaultFontSize: 200 },
    { autoLockMinutes: 0 },
    { autoLockMinutes: 99999 },
    { autoLockMinutes: null },
    { logRetentionDays: -1 },
    { defaultFont: '' }
  ])('refuses %j', async (body) => {
    const res = await request(app)
      .put('/api/config')
      .set(...auth())
      .send(body)
    expect(res.status).toBe(400)
  })

  it('accepts what the Settings page sends', async () => {
    const res = await request(app)
      .put('/api/config')
      .set(...auth())
      .send({
        theme: 'system',
        defaultFont: 'JetBrains Mono',
        defaultFontSize: 14,
        logRetentionDays: 30,
        autoLockMinutes: 20
      })
    expect(res.status).toBe(200)
    expect(res.body.autoLockMinutes).toBe(20)
    expect(res.body.theme).toBe('system')
  })
})
