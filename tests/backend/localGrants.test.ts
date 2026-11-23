/**
 * [NFR-02][BL-47] Grants for SFTP local files: the registry, the file-name rules and the
 * request parser. `src/main/localGrants.ts` has no Electron or fs imports.
 */
import { describe, it, expect } from 'vitest'
import {
  LocalGrantRegistry,
  isAllowedLocalName,
  parseGrantResolveRequest
} from '../../src/main/localGrants'

describe('[BL-47] LocalGrantRegistry', () => {
  it('issues 32-hex ids that are unique', () => {
    const reg = new LocalGrantRegistry()
    reg.openWindow(1, 's1')
    const ids = new Set(
      Array.from({ length: 50 }, (_, i) => reg.issue(1, 'read', `/tmp/file-${i}`))
    )
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('refuses to issue for a window that is not an open SFTP window', () => {
    const reg = new LocalGrantRegistry()
    expect(() => reg.issue(7, 'read', '/tmp/a')).toThrow(/not an SFTP window/i)
    reg.openWindow(7, 's')
    reg.closeWindow(7)
    expect(() => reg.issue(7, 'read', '/tmp/a')).toThrow()
  })

  it('looks a grant up with its kind, path, window and session', () => {
    const reg = new LocalGrantRegistry()
    reg.openWindow(1, 'sess-a')
    const id = reg.issue(1, 'write', '/tmp/out.bin')
    expect(reg.lookup(id)).toEqual({
      kind: 'write',
      path: '/tmp/out.bin',
      windowId: 1,
      sessionId: 'sess-a'
    })
    expect(reg.lookup('0'.repeat(32))).toBeNull()
  })

  it('reuses the grant for the same window, kind and path', () => {
    const reg = new LocalGrantRegistry()
    reg.openWindow(1, 's')
    const a = reg.issue(1, 'read', '/tmp/a')
    expect(reg.issue(1, 'read', '/tmp/a')).toBe(a)
    expect(reg.issue(1, 'dir', '/tmp/a')).not.toBe(a)
  })

  it('closing a window revokes only its grants', () => {
    const reg = new LocalGrantRegistry()
    reg.openWindow(1, 's1')
    reg.openWindow(2, 's2')
    const one = reg.issue(1, 'read', '/a')
    const two = reg.issue(2, 'read', '/b')
    reg.closeWindow(1)
    expect(reg.lookup(one)).toBeNull()
    expect(reg.lookup(two)).not.toBeNull()
  })

  it('clear() revokes everything, as a lock does', () => {
    const reg = new LocalGrantRegistry()
    reg.openWindow(1, 's')
    const id = reg.issue(1, 'read', '/a')
    reg.clear()
    expect(reg.lookup(id)).toBeNull()
    expect(reg.isOpen(1)).toBe(false)
  })

  it('evicts the least recently used grant beyond the per-window cap', () => {
    const reg = new LocalGrantRegistry({ maxPerWindow: 3 })
    reg.openWindow(1, 's')
    const a = reg.issue(1, 'read', '/a')
    const b = reg.issue(1, 'read', '/b')
    const c = reg.issue(1, 'read', '/c')
    reg.lookup(a) // a is now the most recently used
    const d = reg.issue(1, 'read', '/d')
    expect(reg.lookup(b)).toBeNull()
    for (const id of [a, c, d]) expect(reg.lookup(id)).not.toBeNull()
  })
})

describe('[BL-47] isAllowedLocalName', () => {
  const both: [string, boolean][] = [
    ['report.pdf', true],
    ['.bashrc', true],
    ['a b (1).txt', true],
    ['ünïcode.txt', true],
    ['', false],
    ['.', false],
    ['..', false],
    ['a/b', false],
    ['a\0b', false],
    ['a\nb', false],
    ['x'.repeat(255), true],
    ['x'.repeat(256), false]
  ]
  it.each(both)('both platforms: %j → %s', (name, ok) => {
    expect(isAllowedLocalName(name, 'linux')).toBe(ok)
    expect(isAllowedLocalName(name, 'win32')).toBe(ok)
  })

  it('a backslash is a file-name character on POSIX only', () => {
    expect(isAllowedLocalName('a\\b', 'linux')).toBe(true)
    expect(isAllowedLocalName('a\\b', 'win32')).toBe(false)
  })

  it.each(['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a.', 'a ', 'a.txt.'])(
    'win32 refuses %j',
    (name) => {
      expect(isAllowedLocalName(name, 'win32')).toBe(false)
      expect(isAllowedLocalName(name, 'linux')).toBe(name.length > 0)
    }
  )

  it.each([
    'CON',
    'con',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'com9',
    'COM0',
    'LPT1',
    'LPT9',
    'COM¹',
    'LPT²',
    'CONIN$',
    'CONOUT$',
    'nul.txt',
    'CON.tar.gz'
  ])('win32 refuses the device name %j', (name) => {
    expect(isAllowedLocalName(name, 'win32')).toBe(false)
    expect(isAllowedLocalName(name, 'linux')).toBe(true)
  })

  it('win32 allows names that only contain a device name', () => {
    expect(isAllowedLocalName('console.txt', 'win32')).toBe(true)
    expect(isAllowedLocalName('COM10', 'win32')).toBe(true)
  })
})

describe('[BL-47] parseGrantResolveRequest', () => {
  const valid = {
    type: 'grant-resolve',
    requestId: '8e4b6c9a-0f6e-4d4e-9f55-0a8f2f2a1b11',
    sessionId: 'session-abc',
    grant: 'a'.repeat(32),
    access: 'read'
  }

  it('accepts a well-formed request, with or without a name', () => {
    expect(parseGrantResolveRequest(valid)).toEqual(valid)
    expect(parseGrantResolveRequest({ ...valid, name: 'a.txt' })).toEqual({
      ...valid,
      name: 'a.txt'
    })
  })

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['wrong type', { ...valid, type: 'lock' }],
    ['no requestId', { ...valid, requestId: undefined }],
    ['empty requestId', { ...valid, requestId: '' }],
    ['bad grant', { ...valid, grant: 'xyz' }],
    ['grant with upper case', { ...valid, grant: 'A'.repeat(32) }],
    ['bad access', { ...valid, access: 'rw' }],
    ['no session', { ...valid, sessionId: '' }],
    ['non-string name', { ...valid, name: 5 }],
    ['name too long', { ...valid, name: 'x'.repeat(256) }]
  ])('rejects %s', (_label, raw) => {
    expect(parseGrantResolveRequest(raw)).toBeNull()
  })
})
