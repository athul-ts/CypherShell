/**
 * [FR-06.1][NFR-03][BL-16] A client that resets a forwarded connection must
 * not crash the backend.
 *
 * Regression: local-forward sockets had no `error` listener, so an ECONNRESET
 * (a browser tab closed mid-request, curl interrupted, …) was an unhandled
 * error that killed the backend and every SSH session with it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import net, { type AddressInfo } from 'net'
import type { Express } from 'express'
import { createApp } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { SSHService } from '../../backend/src/services/ssh.service'
import { TunnelService } from '../../backend/src/services/tunnel.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let sshServer: TestSshServer
let sessionId: string
let forwardPort: number
const uncaught: Error[] = []
const onUncaught = (err: Error): void => {
  uncaught.push(err)
}

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]

async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

/** Sends a line through the forward and resolves with what comes back. */
function roundTrip(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(payload))
    socket.once('data', (data) => {
      resolve(data.toString())
      socket.end()
    })
    socket.once('error', reject)
  })
}

const settle = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  process.on('uncaughtException', onUncaught)
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
      name: 'Tunnel host',
      host: sshServer.host,
      port: sshServer.port,
      username: sshServer.username,
      authMethod: 'password',
      password: sshServer.password
    })
  sessionId = (
    await request(app)
      .post(`/api/profiles/${profile.body.id}/connect`)
      .set(...auth())
  ).body.sessionId
  forwardPort = await freePort()
  await TunnelService.startLocalForward(sessionId, forwardPort, '127.0.0.1', 7)
})

afterAll(async () => {
  process.off('uncaughtException', onUncaught)
  SSHService.removeSession(sessionId)
  await sshServer.close()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('[FR-06.1][BL-16] local forward resilience', () => {
  it('relays data through the forward', async () => {
    expect(await roundTrip(forwardPort, 'ping')).toBe('ping')
  })

  it('survives a client reset after the channel is open', async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(forwardPort, '127.0.0.1', () => socket.write('hello'))
      socket.once('data', () => {
        socket.resetAndDestroy()
        resolve()
      })
      socket.once('error', reject)
    })
    await settle()

    expect(uncaught).toEqual([])
    expect(SSHService.getSession(sessionId)).toBeDefined()
    expect(await roundTrip(forwardPort, 'still alive')).toBe('still alive')
  })

  it('survives a client reset before the channel opens', async () => {
    await new Promise<void>((resolve) => {
      const socket = net.connect(forwardPort, '127.0.0.1', () => {
        socket.resetAndDestroy()
        resolve()
      })
      socket.on('error', () => {})
    })
    await settle()

    expect(uncaught).toEqual([])
    expect(await roundTrip(forwardPort, 'again')).toBe('again')
  })
})
