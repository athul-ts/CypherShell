/**
 * [§11.2][BL-35] Choosing the Light theme must restyle every surface.
 *
 * The app's dark colours are Tailwind utilities written into the components, so
 * the light theme maps each one to a light value in main.css under `.light`.
 * This fails when a component starts using a dark utility that has no mapping,
 * which would leave a dark patch in the light theme.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve('src/renderer/src')
const css = fs.readFileSync(path.join(SRC, 'assets/main.css'), 'utf8')

/** White text/knobs sit on coloured buttons and stay white in both themes. */
const STAYS_THE_SAME = new Set([
  'text-white',
  'hover:text-white',
  'after:bg-white',
  'peer-checked:after:border-white'
])

/** Dark surfaces and slate text, plus the accent text colours whose pale shades fail on white. */
const TOKEN = new RegExp(
  '[A-Za-z:-]*(?:' +
    '(?:bg|text|border|from|to|placeholder)-(?:\\[#[0-9a-fA-F]{6}\\]|slate-\\d{3}|white)' +
    '|text-(?:amber|emerald|blue|red|violet|purple)-\\d{3}' +
    ')(?:\\/(?:\\[[0-9.]+\\]|\\d+))?',
  'g'
)

function usedDarkTokens(): string[] {
  const found = new Set<string>()
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx')) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(TOKEN)) found.add(match[0])
      }
    }
  }
  walk(SRC)
  return [...found].filter((token) => !STAYS_THE_SAME.has(token)).sort()
}

const escape = (token: string): string => token.replace(/([\\:[\]#/.])/g, '\\$1')

describe('[BL-35] light theme coverage', () => {
  it('finds the utilities the app uses (the scan itself works)', () => {
    const tokens = usedDarkTokens()
    expect(tokens).toContain('bg-[#0a0a0f]')
    expect(tokens).toContain('text-slate-200')
    expect(tokens).toContain('hover:bg-slate-700')
    expect(tokens).toContain('text-amber-300') // accent colours are scanned too
  })

  it('every dark utility in use has a .light override', () => {
    // group-hover utilities are written as `.light .group:hover .<class>`
    const covered = (token: string): boolean =>
      css.includes(`.light .${escape(token)}`) ||
      css.includes(`.light .group:hover .${escape(token)}`)
    const missing = usedDarkTokens().filter((token) => !covered(token))
    expect(missing).toEqual([])
  })

  it('defines light values for the shadcn colour variables', () => {
    expect(css).toMatch(/:root\.light\s*\{[^}]*--background:/)
    expect(css).toMatch(/:root\.light\s*\{[^}]*--foreground:/)
  })
})
