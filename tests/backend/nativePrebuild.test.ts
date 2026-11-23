/**
 * [NFR-07][BL-36] Packaging keeps only the target's better-sqlite3 prebuild and
 * checks its architecture from the binary header.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const { readBinaryArch, assertBinaryArch, prunePrebuilds } = createRequire(import.meta.url)(
  '../../scripts/native-prebuild.cjs'
) as {
  readBinaryArch: (file: string) => string
  assertBinaryArch: (file: string, arch: string) => void
  prunePrebuilds: (dir: string, platform: string, arch: string) => string
}

const REAL = path.resolve('backend/node_modules/better-sqlite3/prebuilds')
const real = (name: string): string => path.join(REAL, name)

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-prebuild-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('[BL-36] readBinaryArch on the real prebuilds', () => {
  it.each([
    ['win32-x64.node', 'x64'],
    ['win32-arm64.node', 'arm64'],
    ['linux-x64.node', 'x64'],
    ['linux-arm64.node', 'arm64'],
    ['darwin-x64.node', 'x64'],
    ['darwin-arm64.node', 'arm64']
  ])('%s is %s', (file, arch) => {
    expect(readBinaryArch(real(file))).toBe(arch)
  })

  it('unknown for a file that is not a binary', () => {
    const f = path.join(root, 'x.node')
    fs.writeFileSync(f, 'not a binary')
    expect(readBinaryArch(f)).toBe('unknown')
  })
})

describe('[BL-36] assertBinaryArch', () => {
  it('passes for a matching architecture', () => {
    expect(() => assertBinaryArch(real('win32-x64.node'), 'x64')).not.toThrow()
  })

  it('names both architectures when they differ', () => {
    expect(() => assertBinaryArch(real('win32-x64.node'), 'arm64')).toThrow(
      /built for "x64" but the target is "arm64"/
    )
  })
})

describe('[BL-36] prunePrebuilds', () => {
  function stage(): string {
    const bs3 = path.join(root, 'better-sqlite3')
    fs.mkdirSync(path.join(bs3, 'prebuilds'), { recursive: true })
    fs.mkdirSync(path.join(bs3, 'build', 'Release'), { recursive: true })
    for (const n of ['win32-x64', 'linux-x64', 'darwin-arm64']) {
      fs.writeFileSync(path.join(bs3, 'prebuilds', `${n}.node`), n)
    }
    fs.writeFileSync(path.join(bs3, 'build', 'Release', 'better_sqlite3.node'), 'local build')
    return bs3
  }

  it('keeps only the target prebuild and removes build/', () => {
    const bs3 = stage()
    const kept = prunePrebuilds(bs3, 'linux', 'x64')
    expect(kept).toBe(path.join(bs3, 'prebuilds', 'linux-x64.node'))
    expect(fs.readdirSync(path.join(bs3, 'prebuilds'))).toEqual(['linux-x64.node'])
    expect(fs.existsSync(path.join(bs3, 'build'))).toBe(false)
  })

  it('throws when the target prebuild is missing', () => {
    expect(() => prunePrebuilds(stage(), 'win32', 'arm64')).toThrow(
      /no prebuilt binary "win32-arm64.node"/
    )
  })
})
