/**
 * [NFR-06][BL-44] The renderer uses the typed `window.api` from src/preload/index.d.ts;
 * a cast around it hides a missing declaration.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

const CAST = /window\.api\s+as\s+unknown|window\s+as\s+unknown\s+as\s*\{\s*api/

describe('[BL-44] window.api is typed', () => {
  const files = sourceFiles(path.resolve('src/renderer/src'))

  it('scans the renderer sources', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('no source casts window.api', () => {
    const offenders = files.filter((file) => CAST.test(fs.readFileSync(file, 'utf8')))
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([])
  })

  it('the unused Terminal page is gone', () => {
    expect(fs.existsSync(path.resolve('src/renderer/src/pages/Terminal.tsx'))).toBe(false)
  })
})
