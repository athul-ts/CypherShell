/**
 * [FR-08.6][BL-28] GET /api/audit/export — the CSV the Logs page saves.
 *
 * Regression: only the Detail column doubled its quotes, so a `"` in a profile
 * name, host or error message broke its row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp, launch } from './helpers/createApp'
import { prisma } from '../../backend/src/config/db'
import { AuditService } from '../../backend/src/services/audit.service'
import { CryptoService } from '../../backend/src/services/crypto.service'

let app: Express
let token: string

/** Minimal RFC 4180 reader: quoted fields may hold commas, line breaks and doubled quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        quoted = false
      } else {
        field += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  row.push(field)
  rows.push(row)
  return rows
}

beforeAll(async () => {
  app = createApp()
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
  const res = await request(app)
    .post('/api/auth/setup/skip')
    .set(...launch())
  token = res.body.token
})

afterAll(async () => {
  await prisma.auditLog.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.appConfig.deleteMany()
  CryptoService.clearActiveKey()
})

describe('[FR-08.6][BL-28] GET /api/audit/export', () => {
  it('requires the session token', async () => {
    const res = await request(app).get('/api/audit/export')
    expect(res.status).toBe(401)
  })

  it('returns every entry as CSV whose fields survive quotes, commas and line breaks', async () => {
    const name = 'web "prod", eu'
    const host = 'jump "a",b'
    await AuditService.logConnection(null, name, host, false, 'server said "no",\nbye')
    await AuditService.logSftpTransfer(
      null,
      'sftp_upload',
      'Uploaded "a,b".txt',
      true,
      42,
      undefined,
      name,
      host
    )

    const res = await request(app).get('/api/audit/export').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)

    const [header, ...rows] = parseCsv(res.text)
    expect(header).toEqual([
      'Timestamp',
      'Type',
      'Profile',
      'Host',
      'Detail',
      'Success',
      'Error',
      'Size'
    ])
    expect(rows).toHaveLength(2)
    const connection = rows.find((r) => r[1] === 'connection')
    const upload = rows.find((r) => r[1] === 'sftp_upload')
    expect(connection?.slice(2)).toEqual([
      name,
      host,
      'Connection failed',
      'No',
      'server said "no",\nbye',
      ''
    ])
    expect(upload?.slice(2)).toEqual([name, host, 'Uploaded "a,b".txt', 'Yes', '', '42'])
  })
})
