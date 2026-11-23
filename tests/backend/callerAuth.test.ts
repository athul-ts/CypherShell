/**
 * [NFR-02][BL-17] Only CypherShell's own renderer can drive the local API.
 *
 * Regressions covered:
 *  - CORS accepted `Origin: null` and every localhost origin, and the
 *    lock-off unlock handed any caller a token without a password.
 *  - Nothing checked the `Host` header, so a DNS-rebinding page was
 *    same-origin with the API.
 *  - The terminal WebSocket upgrade checked neither Origin nor Host.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import WebSocket from 'ws'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import type { Express } from 'express'
import { createApp, launch, TEST_LAUNCH_SECRET } from './helpers/createApp'
import { createApp as createBackendApp } from '../../backend/src/app'
import { setupTerminalWebSocket } from '../../backend/src/websocket/terminal.ws'
import {
  callerPolicyFromEnv,
  isAllowedHost,
  isAllowedOrigin
} from '../../backend/src/middleware/caller.middleware'
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
  // Lock off: the configuration in which unlock needs no password.
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

describe('[BL-17] launch secret on /api/auth/*', () => {
  it('refuses the lock-off unlock without the launch secret — no token is handed out', async () => {
    const res = await request(app).post('/api/auth/unlock').send({})
    expect(res.status).toBe(403)
    expect(res.body.token).toBeUndefined()
  })

  it('refuses a wrong launch secret on every auth endpoint', async () => {
    for (const path of ['/api/auth/status', '/api/auth/unlock', '/api/auth/setup/skip']) {
      const res = await request(app).post(path).set('X-CypherShell-Launch', 'not-the-secret')
      expect(res.status).toBe(403)
    }
  })

  it('serves the renderer, which sends the launch secret', async () => {
    const res = await request(app)
      .post('/api/auth/unlock')
      .set(...launch())
      .send({})
    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe('string')
  })

  it('refuses every auth request when no launch secret is configured', async () => {
    const unconfigured = createBackendApp({
      rateLimit: false,
      callerPolicy: { launchSecret: '', extraOrigins: [] }
    })
    const res = await request(unconfigured).get('/api/auth/status').set('X-CypherShell-Launch', '')
    expect(res.status).toBe(403)
  })
})

describe('[BL-17] Origin allowlist', () => {
  it.each(['null', 'http://localhost:8080', 'http://127.0.0.1:5173', 'https://attacker.example'])(
    'refuses Origin %s with 403 and no CORS grant',
    async (origin) => {
      const res = await request(app).get('/api/health').set('Origin', origin)
      expect(res.status).toBe(403)
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
    }
  )

  it('refuses a CORS preflight from a sandboxed (null-origin) page', async () => {
    const res = await request(app)
      .options('/api/auth/unlock')
      .set('Origin', 'null')
      .set('Access-Control-Request-Method', 'POST')
    expect(res.status).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('accepts the packaged renderer: no Origin on REST, file:// on WebSocket upgrades', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200)
    expect((await request(app).get('/api/health').set('Origin', 'file://')).status).toBe(200)
  })

  it('grants CORS to the exact dev-server origin, and to nothing else in the variable', async () => {
    const policy = callerPolicyFromEnv({
      LAUNCH_SECRET: TEST_LAUNCH_SECRET,
      ALLOWED_CORS_ORIGINS: 'http://localhost:5173/, *, null, not a url'
    })
    expect(policy.extraOrigins).toEqual(['http://localhost:5173'])
    const dev = createBackendApp({ rateLimit: false, callerPolicy: policy })

    const preflight = await request(dev)
      .options('/api/auth/status')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-cyphershell-launch')
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173')

    const res = await request(dev)
      .get('/api/auth/status')
      .set('Origin', 'http://localhost:5173')
      .set(...launch())
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')

    expect((await request(dev).get('/api/health').set('Origin', 'null')).status).toBe(403)
    expect(
      (await request(dev).get('/api/health').set('Origin', 'http://localhost:5174')).status
    ).toBe(403)
  })

  it('a production policy allows only file:// and no Origin', () => {
    const production = callerPolicyFromEnv({ LAUNCH_SECRET: 'x' })
    expect(isAllowedOrigin(production, undefined)).toBe(true)
    expect(isAllowedOrigin(production, 'file://')).toBe(true)
    expect(isAllowedOrigin(production, 'null')).toBe(false)
    expect(isAllowedOrigin(production, 'http://localhost:5173')).toBe(false)
  })
})

describe('[BL-17] Host check against DNS rebinding', () => {
  it('refuses a request whose Host is not the loopback interface', async () => {
    const res = await request(app).get('/api/health').set('Host', 'attacker.example:4000')
    expect(res.status).toBe(403)
    const auth = await request(app)
      .post('/api/auth/unlock')
      .set('Host', 'attacker.example:4000')
      .set(...launch())
      .send({})
    expect(auth.status).toBe(403)
    expect(auth.body.token).toBeUndefined()
  })

  it('accepts loopback host names on any port, and nothing else', () => {
    for (const host of ['127.0.0.1:4000', 'localhost:4123', '[::1]:4000', 'LOCALHOST']) {
      expect(isAllowedHost(host)).toBe(true)
    }
    for (const host of [
      undefined,
      '',
      'attacker.example',
      '127.0.0.1.attacker.example:4000',
      'localhost.attacker.example'
    ]) {
      expect(isAllowedHost(host)).toBe(false)
    }
  })
})

/**
 * Attempts a terminal upgrade and resolves with the HTTP status the server
 * answered — 101 when the WebSocket opened.
 */
function upgradeStatus(query: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws/terminal/session-none?${query}`, {
      headers
    })
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0)
      ws.terminate()
    })
    ws.on('open', () => {
      resolve(101)
      ws.close()
    })
    ws.on('error', () => {
      /* the server drops refused sockets */
    })
  })
}

describe('[BL-17] terminal WebSocket upgrade', () => {
  const valid = (): string => `token=${encodeURIComponent(token)}&launch=${TEST_LAUNCH_SECRET}`

  it('opens with the token, the launch secret and the packaged renderer origin', async () => {
    expect(await upgradeStatus(valid())).toBe(101)
    expect(await upgradeStatus(valid(), { Origin: 'file://' })).toBe(101)
  })

  it('refuses a foreign Origin before any shell opens', async () => {
    expect(await upgradeStatus(valid(), { Origin: 'https://attacker.example' })).toBe(403)
    expect(await upgradeStatus(valid(), { Origin: 'null' })).toBe(403)
  })

  it('refuses a foreign Host (DNS rebinding)', async () => {
    expect(await upgradeStatus(valid(), { Host: `attacker.example:${wsPort}` })).toBe(403)
  })

  it('refuses a missing or wrong launch secret', async () => {
    expect(await upgradeStatus(`token=${encodeURIComponent(token)}`)).toBe(403)
    expect(await upgradeStatus(`token=${encodeURIComponent(token)}&launch=wrong`)).toBe(403)
  })

  it('refuses a missing token', async () => {
    expect(await upgradeStatus(`launch=${TEST_LAUNCH_SECRET}`)).toBe(401)
  })
})
