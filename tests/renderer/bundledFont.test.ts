/**
 * [§11.3][BL-35] JetBrains Mono is bundled with the app: the terminal font loads
 * from files shipped in the package, not from a CDN.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (file: string): string => fs.readFileSync(path.resolve(file), 'utf8')

describe('[BL-35] bundled terminal font', () => {
  it('the renderer imports the regular and bold Latin faces', () => {
    const main = read('src/renderer/src/main.tsx')
    expect(main).toContain('@fontsource/jetbrains-mono/latin-400.css')
    expect(main).toContain('@fontsource/jetbrains-mono/latin-700.css')
  })

  it('the font files and their @font-face rules are in the installed package', () => {
    for (const weight of ['400', '700']) {
      const dir = 'node_modules/@fontsource/jetbrains-mono'
      expect(
        fs.existsSync(path.resolve(dir, `files/jetbrains-mono-latin-${weight}-normal.woff2`))
      ).toBe(true)
      const css = read(`${dir}/latin-${weight}.css`)
      expect(css).toContain("font-family: 'JetBrains Mono'")
      expect(css).not.toMatch(/url\(https?:/) // local files only
    }
  })

  it('the terminal default font family starts with the bundled font', () => {
    expect(read('src/renderer/src/store/terminalThemeStore.ts')).toContain(
      "fontFamily: 'JetBrains Mono, Consolas, monospace'"
    )
  })

  it('the page policy allows same-origin fonts only', () => {
    const html = read('src/renderer/index.html')
    expect(html).toContain("font-src 'self'")
    expect(html).not.toMatch(/font-src[^;]*https?:/)
  })
})
