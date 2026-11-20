/**
 * [NFR-07][BL-37] The macOS build fails unless latest-mac.yml lists both architectures.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const { checkMacUpdateFeed } = createRequire(import.meta.url)(
  '../../scripts/check-mac-update-feed.cjs'
) as { checkMacUpdateFeed: (file: string) => string[] }

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-feed-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function feed(entries: string[]): string {
  const f = path.join(dir, 'latest-mac.yml')
  const files = entries.map((u) => `  - url: ${u}\n    sha512: abc123==\n    size: 1234`).join('\n')
  fs.writeFileSync(f, `version: 1.0.0\nfiles:\n${files}\npath: ${entries[0]}\n`)
  return f
}

describe('[BL-37] checkMacUpdateFeed', () => {
  it('passes when both zips are listed with sha512 and size', () => {
    const f = feed(['CypherShell-1.0.0-macos-x64.zip', 'CypherShell-1.0.0-macos-arm64.zip'])
    expect(checkMacUpdateFeed(f)).toEqual([])
  })

  it('reports a missing arm64 zip', () => {
    const f = feed(['CypherShell-1.0.0-macos-x64.zip'])
    expect(checkMacUpdateFeed(f).join('\n')).toMatch(/arm64/)
  })

  it('reports a missing x64 zip', () => {
    const f = feed(['CypherShell-1.0.0-macos-arm64.zip'])
    expect(checkMacUpdateFeed(f).join('\n')).toMatch(/x64/)
  })

  it('reports an entry without sha512 or size', () => {
    const f = path.join(dir, 'latest-mac.yml')
    fs.writeFileSync(
      f,
      'version: 1.0.0\nfiles:\n  - url: a-macos-x64.zip\n    size: 1\n  - url: a-macos-arm64.zip\n    sha512: x\n'
    )
    const problems = checkMacUpdateFeed(f).join('\n')
    expect(problems).toMatch(/x64.*sha512/s)
    expect(problems).toMatch(/arm64.*size/s)
  })

  it('reports a missing file', () => {
    expect(checkMacUpdateFeed(path.join(dir, 'nope.yml')).join('\n')).toMatch(/not found/)
  })
})
