/**
 * [NFR-02][BL-46] electron-builder.yml turns the Node-mode fuses off and the integrity fuses on.
 * `@electron/fuses read --app <packaged exe>` shows the same values on a packaged build.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { createRequire } from 'module'

const config = yaml.load(fs.readFileSync(path.resolve('electron-builder.yml'), 'utf8')) as {
  productName: string
  electronFuses?: Record<string, boolean>
  win?: { executableName?: string }
  linux?: { executableName?: string }
}

const buildWorkflow = yaml.load(
  fs.readFileSync(path.resolve('.github/workflows/build.yml'), 'utf8')
) as { jobs: { build: { steps: { name?: string; run?: string }[] } } }

const { EXPECTED_FUSES, compareFuses } = createRequire(import.meta.url)(
  '../../scripts/check-fuses.cjs'
) as {
  EXPECTED_FUSES: Record<string, boolean>
  compareFuses: (actual: Record<string, boolean>) => string[]
}

describe('[BL-46] electron-builder fuses', () => {
  it('turns the runtime back doors off and the integrity checks on', () => {
    expect(config.electronFuses).toMatchObject({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      enableCookieEncryption: true
    })
  })

  it('the packaged-app check expects exactly what the config sets', () => {
    for (const [fuse, value] of Object.entries(EXPECTED_FUSES)) {
      expect(config.electronFuses?.[fuse]).toBe(value)
    }
  })
})

describe('[BL-46] the fuse check in build.yml reads the packaged executable', () => {
  const step = buildWorkflow.jobs.build.steps.find((s) => s.name === 'Check Electron fuses')
  const script = step?.run ?? ''

  /** The path the step passes to check-fuses.cjs for one platform of its `case`. */
  function checkedPath(platform: string): string | undefined {
    return new RegExp(`^\\s*${platform}\\)\\s+.*check-fuses\\.cjs\\s+"?([^\\s";]+)`, 'm').exec(
      script
    )?.[1]
  }

  it('uses win.executableName on Windows', () => {
    expect(checkedPath('win')).toBe(`dist/win-unpacked/${config.win?.executableName}.exe`)
  })

  // electron-builder names the Linux executable after the app in lower case unless
  // linux.executableName is set. The 1.2.0 Release failed on `CypherShell` here.
  it('uses the lower-case app name on Linux', () => {
    const name = config.linux?.executableName ?? config.productName.toLowerCase()
    expect(checkedPath('linux')).toBe(`dist/linux-unpacked/${name}`)
  })

  it('uses the product name for the macOS app bundle', () => {
    expect(script).toContain(`dist/mac*/${config.productName}.app`)
  })
})

describe('[BL-46] compareFuses', () => {
  it('passes when every expected fuse has its value', () => {
    expect(compareFuses({ ...EXPECTED_FUSES, extra: true })).toEqual([])
  })

  it('names each fuse that differs or is missing', () => {
    const problems = compareFuses({
      ...EXPECTED_FUSES,
      runAsNode: true,
      onlyLoadAppFromAsar: undefined as never
    })
    expect(problems.join('\n')).toMatch(/runAsNode/)
    expect(problems.join('\n')).toMatch(/onlyLoadAppFromAsar/)
    expect(problems).toHaveLength(2)
  })
})
