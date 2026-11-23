/** [FR-04.15][BL-30] Remote paths stay absolute, so the breadcrumb can reach "/". */
import { describe, it, expect } from 'vitest'
import { normalizeSftpPath, parentPath } from '@/lib/sftpPaths'

describe('[BL-30] normalizeSftpPath', () => {
  it.each([
    ['/home/tester', 'docs', '/home/tester/docs'],
    ['/home/tester', '..', '/home'],
    ['/home', '..', '/'],
    ['/', '..', '/'],
    ['/', 'etc', '/etc'],
    ['/a//b/', './c', '/a/b/c'],
    ['.', 'notes.txt', 'notes.txt'],
    ['docs', 'a.txt', 'docs/a.txt']
  ])('joins %j and %j as %j', (base, name, expected) => {
    expect(normalizeSftpPath(base, name)).toBe(expected)
  })
})

describe('[BL-30] parentPath', () => {
  it.each([
    ['/home/tester', '/home'],
    ['/home', '/'],
    ['/', '/'],
    ['.', '.'],
    ['docs/sub', 'docs'],
    ['docs', '.']
  ])('the parent of %j is %j', (path, expected) => {
    expect(parentPath(path)).toBe(expected)
  })
})
