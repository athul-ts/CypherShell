/**
 * [NFR-02][BL-19] Only revocable tokens minted by this backend process are
 * accepted.
 *
 * Regressions covered:
 *  - `verifyToken` skipped revocation for a token without `jti`, so such a
 *    token survived every lock.
 *  - The signing secret came from the environment / a file in userData that
 *    outlived the process.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import type { Express } from 'express'
import { createApp, launch, TEST_LAUNCH_SECRET } from './helpers/createApp'
import { setupTerminalWebSocket } from '../../backend/src/websocket/terminal.ws'
import { env } from '../../backend/src/config/env'
import { TokenStore } from '../../backend/src/services/token-store.service'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let httpServer: Server
let wsPort: number

beforeAll(async () => {
  app = createApp()
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
})

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

/** Status of each transport for `candidate`: REST, SSE and the terminal WebSocket upgrade. */
async function statuses(candidate: string): Promise<{ rest: number; sse: number; ws: number }> {
  const rest = (await request(app).get('/api/profiles').set('Authorization', `Bearer ${candidate}`))
    .status
  const sse = (
    await request(app).get(
      `/api/sftp/any/progress/up-hygiene?token=${encodeURIComponent(candidate)}`
    )
  ).status
  const ws = await new Promise<number>((resolve) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${wsPort}/ws/terminal/none?token=${encodeURIComponent(candidate)}&launch=${TEST_LAUNCH_SECRET}`
    )
    socket.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0)
      socket.terminate()
    })
    socket.on('open', () => {
      resolve(101)
      socket.close()
    })
    socket.on('error', () => {})
  })
  return { rest, sse, ws }
}

describe('[BL-19] per-process signing secret', () => {
  it('is 48 random bytes held in memory, independent of JWT_SECRET', () => {
    expect(env.jwtSecret).toMatch(/^[0-9a-f]{96}$/)
    expect(env.jwtSecret).not.toBe(process.env.JWT_SECRET)
    expect(env.jwtSecret).not.toBe('vitest-test-secret')
  })

  it('accepts the tokens this process issues', async () => {
    expect(
      (await request(app).get('/api/profiles').set('Authorization', `Bearer ${token}`)).status
    ).toBe(200)
  })
})

describe('[BL-19] tokens that cannot be revoked or were not minted here are refused', () => {
  it('a correctly signed token without jti — on REST, SSE and the WebSocket', async () => {
    const noJti = jwt.sign({ session: 'active' }, env.jwtSecret, { expiresIn: '1h' })
    expect(await statuses(noJti)).toEqual({ rest: 401, sse: 401, ws: 401 })
  })

  it('a token signed with the old JWT_SECRET value', async () => {
    const forged = jwt.sign({ session: 'active', jti: TokenStore.issue() }, 'vitest-test-secret', {
      expiresIn: '1h'
    })
    expect(await statuses(forged)).toEqual({ rest: 401, sse: 401, ws: 401 })
  })

  it('a token signed with another algorithm, even with the right secret and a live jti', async () => {
    const hs512 = jwt.sign({ session: 'active', jti: TokenStore.issue() }, env.jwtSecret, {
      algorithm: 'HS512',
      expiresIn: '1h'
    })
    expect(await statuses(hs512)).toEqual({ rest: 401, sse: 401, ws: 401 })
  })
})
