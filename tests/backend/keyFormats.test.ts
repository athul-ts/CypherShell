/**
 * [FR-05.1][FR-05.4][FR-05.6][BL-12] Every key CypherShell generates or
 * imports must authenticate through the real connect path.
 *
 * Regression: generated keys were saved as PKCS#8 (`BEGIN PRIVATE KEY`),
 * which ssh2 cannot parse, so connecting with them always failed with
 * "Unsupported key format".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { generateKeyPairSync } from 'crypto'
import sshpk from 'sshpk'
import { utils } from 'ssh2'
import { createApp } from './helpers/createApp'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let server: TestSshServer

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]

beforeAll(async () => {
  app = createApp()
  await prisma.profile.deleteMany()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  token = (await request(app).post('/api/auth/setup/skip')).body.token
  server = await startTestSshServer()
})

afterAll(async () => {
  await server.close()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.sSHKey.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

async function storedKey(id: string): Promise<{ privateKey: string; publicKey: string }> {
  const key = await prisma.sSHKey.findUniqueOrThrow({ where: { id } })
  return { privateKey: CryptoService.decrypt(key.encryptedPrivateKey), publicKey: key.publicKey }
}

/** Creates a profile for the key, connects through the API, then disconnects. */
async function connectWithKey(keyId: string, passphrase?: string): Promise<request.Response> {
  server.authorize((await storedKey(keyId)).publicKey)
  const profile = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name: `profile-${keyId}`,
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: passphrase ? 'key+passphrase' : 'key',
      sshKeyId: keyId,
      ...(passphrase && { password: passphrase })
    })
  expect(profile.status).toBe(201)
  const res = await request(app)
    .post(`/api/profiles/${profile.body.id}/connect`)
    .set(...auth())
  if (res.status === 200) {
    await request(app)
      .delete(`/api/sessions/${res.body.sessionId}`)
      .set(...auth())
  }
  return res
}

describe('[FR-05.1][BL-12] generated keys', () => {
  const cases: { label: string; body: Record<string, unknown>; passphrase?: string }[] = [
    { label: 'ED25519', body: { type: 'ed25519' } },
    { label: 'RSA 2048', body: { type: 'rsa', bits: 2048 } },
    { label: 'RSA 4096', body: { type: 'rsa', bits: 4096 } },
    {
      label: 'ED25519 with passphrase',
      body: { type: 'ed25519', passphrase: 'key-pass' },
      passphrase: 'key-pass'
    }
  ]

  for (const { label, body, passphrase } of cases) {
    it(`${label}: stored in a format ssh2 parses, and authenticates`, async () => {
      const res = await request(app)
        .post('/api/keys/generate')
        .set(...auth())
        .send({ name: `gen ${label}`, ...body })
      expect(res.status).toBe(200)

      const { privateKey } = await storedKey(res.body.id)
      expect(privateKey).toContain('BEGIN OPENSSH PRIVATE KEY')
      expect(utils.parseKey(privateKey, passphrase)).not.toBeInstanceOf(Error)

      const connect = await connectWithKey(res.body.id, passphrase)
      expect(connect.status).toBe(200)
    }, 60000)
  }

  it('RSA 4096 really is 4096 bits', async () => {
    const res = await request(app)
      .post('/api/keys/generate')
      .set(...auth())
      .send({ name: 'size check', type: 'rsa', bits: 4096 })
    const { publicKey } = await storedKey(res.body.id)
    expect(sshpk.parseKey(publicKey, 'ssh').size).toBe(4096)
  }, 60000)

  it('[FR-05.6] a generation passphrase is applied, not ignored', async () => {
    const res = await request(app)
      .post('/api/keys/generate')
      .set(...auth())
      .send({ name: 'protected', type: 'ed25519', passphrase: 'pp' })
    const { privateKey } = await storedKey(res.body.id)
    expect(utils.parseKey(privateKey)).toBeInstanceOf(Error) // needs the passphrase
    const list = await request(app)
      .get('/api/keys')
      .set(...auth())
    expect(list.body.find((k: { id: string }) => k.id === res.body.id).hasPassphrase).toBe(true)
  })

  it('rejects key sizes for ED25519 and unknown types', async () => {
    const bad = await request(app)
      .post('/api/keys/generate')
      .set(...auth())
      .send({ name: 'bad', type: 'ed25519', bits: 4096 })
    expect(bad.status).toBe(400)
    const unknown = await request(app)
      .post('/api/keys/generate')
      .set(...auth())
      .send({ name: 'bad', type: 'dsa' })
    expect(unknown.status).toBe(400)
  })
})

describe('[FR-05.2][FR-05.4][BL-12] imported keys', () => {
  async function importKey(privateKey: string, passphrase?: string): Promise<request.Response> {
    return request(app)
      .post('/api/keys/import')
      .set(...auth())
      .send({ name: `import ${Math.random()}`, privateKey, ...(passphrase && { passphrase }) })
  }

  it('PKCS#8 (BEGIN PRIVATE KEY) is converted and authenticates', async () => {
    const pkcs8 = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    }).privateKey
    const res = await importKey(pkcs8)
    expect(res.status).toBe(200)
    expect((await storedKey(res.body.id)).privateKey).toContain('BEGIN OPENSSH PRIVATE KEY')
    expect((await connectWithKey(res.body.id)).status).toBe(200)
  })

  it('PKCS#1 RSA PEM is kept as-is and authenticates', async () => {
    const pkcs1 = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    }).privateKey
    const res = await importKey(pkcs1)
    expect(res.status).toBe(200)
    expect((await storedKey(res.body.id)).privateKey).toBe(pkcs1)
    expect((await connectWithKey(res.body.id)).status).toBe(200)
  })

  it('[FR-05.4] an ED25519 PuTTY PPK is converted and authenticates', async () => {
    const openssh = utils.generateKeyPairSync('ed25519').private
    const ppk = sshpk.parsePrivateKey(openssh, 'auto').toString('putty')
    expect(utils.parseKey(ppk)).toBeInstanceOf(Error) // ssh2 alone cannot read it
    const res = await importKey(ppk)
    expect(res.status).toBe(200)
    expect((await connectWithKey(res.body.id)).status).toBe(200)
  })

  it('[FR-05.6] an encrypted OpenSSH key keeps its passphrase and authenticates', async () => {
    const encrypted = utils.generateKeyPairSync('ed25519', {
      passphrase: 'imported-pass',
      cipher: 'aes256-ctr',
      rounds: 16
    }).private
    const res = await importKey(encrypted, 'imported-pass')
    expect(res.status).toBe(200)
    expect((await storedKey(res.body.id)).privateKey).toBe(encrypted)
    expect((await connectWithKey(res.body.id, 'imported-pass')).status).toBe(200)
  })

  it('a wrong passphrase or garbage is a 400, not a 500', async () => {
    const encrypted = utils.generateKeyPairSync('ed25519', {
      passphrase: 'right',
      cipher: 'aes256-ctr',
      rounds: 16
    }).private
    expect((await importKey(encrypted, 'wrong')).status).toBe(400)
    expect((await importKey('not a key')).status).toBe(400)
  })
})

describe('[BL-12] keys stored before the fix', () => {
  it('a stored PKCS#8 key is converted on first use and the connection succeeds', async () => {
    const legacy = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const publicKey = sshpk.parseKey(legacy.publicKey, 'pem').toString('ssh')
    const key = await prisma.sSHKey.create({
      data: {
        name: 'legacy pkcs8',
        keyType: 'ed25519',
        encryptedPrivateKey: CryptoService.encrypt(legacy.privateKey),
        publicKey,
        fingerprint: sshpk.parseKey(publicKey, 'ssh').fingerprint('sha256').toString()
      }
    })

    expect((await connectWithKey(key.id)).status).toBe(200)
    expect((await storedKey(key.id)).privateKey).toContain('BEGIN OPENSSH PRIVATE KEY')
  })
})

describe('[FR-10][BL-12] .cskb round trip of a passphrase-protected key', () => {
  it('exports and re-imports with the passphrase flag and fingerprint intact', async () => {
    const generated = await request(app)
      .post('/api/keys/generate')
      .set(...auth())
      .send({ name: 'bundle me', type: 'ed25519', passphrase: 'inner-pass' })
    const original = await prisma.sSHKey.findUniqueOrThrow({ where: { id: generated.body.id } })

    const bundle = await request(app)
      .post(`/api/keys/${generated.body.id}/export-bundle`)
      .set(...auth())
      .send({ passphrase: 'bundle-pass', confirmPassphrase: 'bundle-pass' })
    expect(bundle.status).toBe(200)

    const imported = await request(app)
      .post('/api/keys/import-bundle')
      .set(...auth())
      .send({ bundle: bundle.body, passphrase: 'bundle-pass', resolution: 'rename' })
    expect(imported.status).toBe(200)

    const copy = await prisma.sSHKey.findFirstOrThrow({ where: { name: 'bundle me (imported)' } })
    expect(copy.hasPassphrase).toBe(true)
    expect(copy.fingerprint).toBe(original.fingerprint)
  })
})
