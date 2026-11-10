/**
 * [FR-04.11][FR-04.16][BL-14] Cancelling one SFTP transfer must not affect
 * any other transfer or later operations on the session.
 *
 * Regression: every transfer ran on the session's single cached SFTP
 * channel, and cancel destroyed that channel — failing the other transfers
 * and every later listing.
 *
 * The SSH connection is real (in-process server); the SFTP channels are
 * fakes so the test controls exactly when each transfer completes.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import { EventEmitter } from 'events'
import type { Express } from 'express'
import { createApp } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { SSHService } from '../../backend/src/services/ssh.service'
import { SftpService } from '../../backend/src/services/sftp.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

type Callback = (err?: Error | null) => void

/** Minimal stand-in for ssh2's SFTPWrapper. */
class FakeChannel extends EventEmitter {
  destroyed = false
  pendingTransfer: Callback | null = null

  fastPut(_local: string, _remote: string, _opts: unknown, cb: Callback): void {
    this.pendingTransfer = cb
  }
  fastGet(_remote: string, _local: string, _opts: unknown, cb: Callback): void {
    this.pendingTransfer = cb
  }
  readdir(_path: string, cb: (err: Error | undefined, list: unknown[]) => void): void {
    if (this.destroyed) cb(new Error('No SFTP channel'), [])
    else cb(undefined, [])
  }
  rename(_from: string, _to: string, cb: Callback): void {
    cb(this.destroyed ? new Error('No SFTP channel') : null)
  }
  unlink(_path: string, cb: Callback): void {
    cb(null)
  }
  destroy(): void {
    this.destroyed = true
    this.emit('close')
  }
  end(): void {
    this.destroy()
  }
}

let app: Express
let token: string
let sshServer: TestSshServer
let profileId: string
let channels: FakeChannel[]

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
      name: 'SFTP test host',
      host: sshServer.host,
      port: sshServer.port,
      username: sshServer.username,
      authMethod: 'password',
      password: sshServer.password
    })
  profileId = profile.body.id
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

/** Connects for real, then makes every SFTP channel the session opens a FakeChannel. */
async function connectWithFakeSftp(): Promise<string> {
  const res = await request(app)
    .post(`/api/profiles/${profileId}/connect`)
    .set(...auth())
  const sessionId: string = res.body.sessionId
  channels = []
  const session = SSHService.getSession(sessionId)!
  ;(
    session.client as unknown as {
      sftp: (cb: (err: Error | undefined, s: unknown) => void) => void
    }
  ).sftp = (cb) => {
    const channel = new FakeChannel()
    channels.push(channel)
    cb(undefined, channel)
  }
  return sessionId
}

async function waitFor(condition: () => boolean): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > 3000) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}

function collectEvents(transferId: string): { status: string }[] {
  const events: { status: string }[] = []
  SftpService.transferEvents.on(transferId, (e: { status: string }) => events.push(e))
  return events
}

describe('[FR-04.16][BL-14] cancelling a transfer', () => {
  it('leaves the other transfer and later listings working', async () => {
    const sessionId = await connectWithFakeSftp()
    const eventsB = collectEvents('up-b')

    const uploadA = SftpService.upload(sessionId, __filename, '/remote/a.txt', 'up-a')
    const uploadB = SftpService.upload(sessionId, __filename, '/remote/b.txt', 'up-b')
    await waitFor(() => channels.length === 2 && channels.every((c) => c.pendingTransfer))
    const [channelA, channelB] = channels
    expect(channelA).not.toBe(channelB) // each transfer has its own channel

    SftpService.cancelTransfer('up-a')
    expect(channelA.destroyed).toBe(true)
    expect(channelB.destroyed).toBe(false)

    channelA.pendingTransfer!(new Error('channel destroyed')) // ssh2 reports the abort
    await expect(uploadA).resolves.toBeUndefined() // a cancel is not a failure

    channelB.pendingTransfer!(null)
    await expect(uploadB).resolves.toBeUndefined()
    expect(eventsB.map((e) => e.status)).toContain('complete')

    await expect(SftpService.list(sessionId, '.')).resolves.toEqual([])
  })

  it('releases the session consumer for finished and cancelled transfers', async () => {
    const sessionId = await connectWithFakeSftp()
    const consumers = (): number | undefined =>
      SSHService.listSessions().find((s) => s.id === sessionId)?.consumers

    const download = SftpService.download(sessionId, '/remote/x', __filename + '.copy', 'dn-1')
    const upload = SftpService.upload(sessionId, __filename, '/remote/y', 'up-2')
    await waitFor(() => channels.length === 2 && channels.every((c) => c.pendingTransfer))
    expect(consumers()).toBe(2) // in-flight transfers keep the session alive (BL-11)

    SftpService.cancelTransfer('dn-1')
    expect(consumers()).toBe(1)
    channels[0].pendingTransfer!(new Error('channel destroyed'))
    await download

    channels[1].pendingTransfer!(null)
    await upload
    expect(consumers()).toBe(0)
  })

  it('reports a failed rename as an error instead of leaving the transfer hanging', async () => {
    const sessionId = await connectWithFakeSftp()
    const events = collectEvents('up-rename')
    const upload = SftpService.upload(sessionId, __filename, '/remote/z', 'up-rename')
    await waitFor(() => channels.length === 1 && !!channels[0].pendingTransfer)
    const channel = channels[0]
    channel.rename = (_from: string, _to: string, cb: Callback) => cb(new Error('Failure'))

    channel.pendingTransfer!(null)
    await expect(upload).rejects.toThrow('Failure')
    expect(events.map((e) => e.status)).toEqual(['error'])
  })
})
