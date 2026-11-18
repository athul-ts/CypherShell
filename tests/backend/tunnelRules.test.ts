/**
 * [FR-06.4][FR-09.2][BL-34] Saved tunnel rules: they persist, appear in the
 * profile export, and are removed with their profile.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { prisma } from '../../backend/src/config/db'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string
let profileId: string

const auth = (): [string, string] => ['Authorization', `Bearer ${token}`]
const rules = (): request.Test =>
  request(app)
    .get(`/api/profiles/${profileId}/tunnels`)
    .set(...auth())
const save = (body: object): request.Test =>
  request(app)
    .post(`/api/profiles/${profileId}/tunnels`)
    .set(...auth())
    .send(body)

beforeAll(async () => {
  app = createApp()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  token = (
    await request(app)
      .post('/api/auth/setup/skip')
      .set(...launch())
  ).body.token
  const profile = await request(app)
    .post('/api/profiles')
    .set(...auth())
    .send({
      name: 'Rules host',
      host: 'h.example',
      username: 'u',
      authMethod: 'password',
      password: 'p'
    })
  profileId = profile.body.id
})

afterAll(async () => {
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('[FR-06.4][BL-34] saving rules', () => {
  it('starts empty', async () => {
    expect((await rules()).body).toEqual([])
  })

  it('saves a local rule with its host, ports and label', async () => {
    const res = await save({
      type: 'local',
      localPort: '8080', // the form sends digit strings
      remoteHost: 'db.internal',
      remotePort: 5432,
      label: ' Postgres '
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      type: 'local',
      localPort: 8080,
      remoteHost: 'db.internal',
      remotePort: 5432,
      label: 'Postgres',
      profileId
    })
    expect((await rules()).body).toHaveLength(1)
  })

  it('saves remote and dynamic rules without the fields they do not use', async () => {
    const remote = await save({ type: 'remote', localPort: 3000, remotePort: 9000 })
    expect(remote.status).toBe(201)
    expect(remote.body).toMatchObject({ remoteHost: null, remotePort: 9000, label: null })

    const dynamic = await save({ type: 'dynamic', localPort: 1080 })
    expect(dynamic.status).toBe(201)
    expect(dynamic.body).toMatchObject({ remoteHost: null, remotePort: null })
  })

  it('refuses an identical rule with 409', async () => {
    const res = await save({ type: 'dynamic', localPort: 1080 })
    expect(res.status).toBe(409)
  })

  it.each([
    [{ type: 'local', localPort: 0, remoteHost: 'h', remotePort: 80 }, 'port 0'],
    [{ type: 'local', localPort: 8080, remoteHost: 'h', remotePort: 70000 }, 'port 70000'],
    [{ type: 'local', localPort: 8080, remotePort: 80 }, 'missing host'],
    [{ type: 'ftp', localPort: 21 }, 'unknown type'],
    [{ type: 'dynamic', localPort: 'abc' }, 'non-numeric port']
  ])('rejects %j (%s) with 400', async (body) => {
    expect((await save(body)).status).toBe(400)
  })

  it('answers 404 for an unknown profile', async () => {
    const res = await request(app)
      .get('/api/profiles/nope/tunnels')
      .set(...auth())
    expect(res.status).toBe(404)
  })

  it('requires the session token', async () => {
    expect((await request(app).get(`/api/profiles/${profileId}/tunnels`)).status).toBe(401)
  })
})

describe('[FR-09.2][BL-34] export and delete', () => {
  it('the profile export carries the saved rules', async () => {
    const res = await request(app)
      .get('/api/profiles/export')
      .set(...auth())
    const exported = res.body.profiles.find((p: { name: string }) => p.name === 'Rules host')
    expect(exported.tunnels).toHaveLength(3)
    expect(exported.tunnels).toContainEqual(
      expect.objectContaining({ type: 'local', localPort: 8080, remoteHost: 'db.internal' })
    )
  })

  it('deletes a rule, and only through its own profile', async () => {
    const [first] = (await rules()).body
    const other = await request(app)
      .post('/api/profiles')
      .set(...auth())
      .send({
        name: 'Other',
        host: 'o.example',
        username: 'u',
        authMethod: 'password',
        password: 'p'
      })

    const wrongProfile = await request(app)
      .delete(`/api/profiles/${other.body.id}/tunnels/${first.id}`)
      .set(...auth())
    expect(wrongProfile.status).toBe(404)
    expect((await rules()).body).toHaveLength(3) // untouched

    const ok = await request(app)
      .delete(`/api/profiles/${profileId}/tunnels/${first.id}`)
      .set(...auth())
    expect(ok.status).toBe(200)
    expect((await rules()).body).toHaveLength(2)
  })

  it('deleting the profile removes its rules', async () => {
    await request(app)
      .delete(`/api/profiles/${profileId}`)
      .set(...auth())
    expect(await prisma.tunnel.count({ where: { profileId } })).toBe(0)
  })
})
