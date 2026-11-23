/**
 * [NFR-06][BL-43] app.log rotates instead of being overwritten, is size-limited, and the
 * renderer's error reports are validated before they reach it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  AppLog,
  RateLimiter,
  MAX_RENDERER_MESSAGE,
  createRendererErrorHandler,
  parseRendererError,
  rotateLog
} from '../../src/main/log'

let dir: string
let logPath: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-log-'))
  logPath = path.join(dir, 'app.log')
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const read = (p: string): string => fs.readFileSync(p, 'utf8')

describe('[BL-43] rotateLog', () => {
  it('does nothing when there is no log yet', () => {
    expect(() => rotateLog(logPath)).not.toThrow()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('keeps the previous runs as app.log.1 and app.log.2 and drops older ones', () => {
    for (const run of ['first', 'second', 'third']) {
      fs.writeFileSync(logPath, run)
      rotateLog(logPath)
    }
    expect(fs.existsSync(logPath)).toBe(false)
    expect(read(`${logPath}.1`)).toBe('third')
    expect(read(`${logPath}.2`)).toBe('second')
    expect(fs.existsSync(`${logPath}.3`)).toBe(false)
  })
})

describe('[BL-43] AppLog', () => {
  it('two consecutive starts keep the first run as app.log.1', () => {
    const first = new AppLog(logPath)
    first.start()
    first.write('run one')

    const second = new AppLog(logPath)
    second.start()
    second.write('run two')

    expect(read(`${logPath}.1`)).toContain('run one')
    expect(read(logPath)).toContain('run two')
    expect(read(logPath)).not.toContain('run one')
  })

  it('timestamps every line', () => {
    const log = new AppLog(logPath)
    log.start()
    log.write('hello')
    expect(read(logPath)).toMatch(/^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] hello$/m)
  })

  it('rotates once the file would exceed the size limit', () => {
    const log = new AppLog(logPath, 200)
    log.start()
    for (let i = 0; i < 12; i++) log.write(`line ${i} ${'x'.repeat(30)}`)

    expect(fs.existsSync(`${logPath}.1`)).toBe(true)
    expect(fs.statSync(logPath).size).toBeLessThanOrEqual(200)
    // Nothing is lost across the rotation: the newest line is in the live file.
    expect(read(logPath)).toContain('line 11')
  })

  it('never throws when the log cannot be written', () => {
    const log = new AppLog(path.join(dir, 'missing', 'app.log'))
    expect(() => {
      log.start()
      log.write('x')
    }).not.toThrow()
  })
})

describe('[BL-43] parseRendererError', () => {
  it('accepts a context and a message', () => {
    expect(parseRendererError('ProfileDetailPane', 'Failed to connect')).toBe(
      '[Renderer] ProfileDetailPane: Failed to connect'
    )
  })

  it.each([
    [undefined, 'x'],
    ['ctx', undefined],
    [42, 'x'],
    ['ctx', { toString: () => 'x' }],
    ['', 'x']
  ])('rejects %j / %j', (context, message) => {
    expect(parseRendererError(context, message)).toBeNull()
  })

  it('caps an oversized message at 2 KB', () => {
    const line = parseRendererError('ctx', 'a'.repeat(10_000)) as string
    expect(line.length).toBeLessThanOrEqual(MAX_RENDERER_MESSAGE + 64)
    expect(line.endsWith('…')).toBe(true)
  })

  it('cannot forge a log line with line breaks', () => {
    const line = parseRendererError('ctx', 'one\n[2026-01-01T00:00:00Z] forged') as string
    expect(line).not.toMatch(/[\r\n]/)
  })
})

describe('[BL-43] RateLimiter', () => {
  it('allows 20 per minute and refuses a flood', () => {
    let now = 0
    const limiter = new RateLimiter(20, 60_000, () => now)
    const allowed = Array.from({ length: 25 }, () => limiter.allow()).filter(Boolean)
    expect(allowed).toHaveLength(20)
    now = 60_001
    expect(limiter.allow()).toBe(true)
  })
})

describe('[BL-43] createRendererErrorHandler', () => {
  function setup(): { handle: (c: unknown, m: unknown) => void; lines: string[] } {
    const lines: string[] = []
    const now = 0
    const handle = createRendererErrorHandler(
      (line) => lines.push(line),
      new RateLimiter(20, 60_000, () => now)
    )
    return { handle, lines }
  }

  it('writes a valid report to the log', () => {
    const { handle, lines } = setup()
    handle('SFTP', 'transfer failed')
    expect(lines).toEqual(['[Renderer] SFTP: transfer failed'])
  })

  it('drops invalid reports and floods', () => {
    const { handle, lines } = setup()
    handle(1, 2)
    for (let i = 0; i < 40; i++) handle('ctx', `m${i}`)
    expect(lines).toHaveLength(20)
  })
})
