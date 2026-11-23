/**
 * scripts/check-fuses.cjs (BL-46, ADR-005)
 *
 * Reads the Electron fuses of a packaged app and fails unless they match electron-builder.yml.
 * Usage: node scripts/check-fuses.cjs <path to the packaged executable or .app>
 */
const path = require('path')

/** The wire value of an enabled fuse (disabled is 48). */
const ENABLE = 49

/** The fuses the packaged app must have (the same values as `electronFuses` in electron-builder.yml). */
const EXPECTED_FUSES = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  enableCookieEncryption: true
}

/** Problems found in `actual` (fuse name → state); empty when every expected fuse matches. */
function compareFuses(actual) {
  const problems = []
  for (const [fuse, want] of Object.entries(EXPECTED_FUSES)) {
    if (actual[fuse] !== want) {
      problems.push(`${fuse} is ${String(actual[fuse])}, expected ${want}`)
    }
  }
  return problems
}

async function main() {
  const app = process.argv[2]
  if (!app) {
    console.error('usage: check-fuses.cjs <packaged app>')
    process.exit(2)
  }
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses')
  const wire = await getCurrentFuseWire(path.resolve(app))
  const names = Object.fromEntries(
    Object.entries(FuseV1Options)
      .filter(([, value]) => typeof value === 'number')
      .map(([name, index]) => [name, index])
  )
  const actual = {}
  for (const [name, index] of Object.entries(names)) {
    const camel = name.charAt(0).toLowerCase() + name.slice(1)
    const state = wire[index]
    if (state !== undefined) actual[camel] = state === ENABLE
  }
  const problems = compareFuses(actual)
  if (problems.length > 0) {
    for (const p of problems) console.error(`[fuses] ${p}`)
    process.exit(1)
  }
  console.log('[fuses] all expected fuses are set')
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { EXPECTED_FUSES, compareFuses }
