/**
 * scripts/after-pack.cjs
 *
 * Runs AFTER electron-builder stages all files (including extraResources)
 * but BEFORE the installer is created. At this point, the staged copy of
 * backend/node_modules is in dist/win-unpacked/resources/backend/ and is NOT
 * locked by any running process — so we can safely rebuild better-sqlite3
 * against Electron's ABI without touching the source node_modules at all.
 *
 * This means:
 *  - dev mode: source backend/node_modules uses system Node.js ABI  → works
 *  - production: staged copy uses Electron ABI (rebuilt here)        → works
 *  - no EPERM: we never touch a file the dev server has open
 */

const { rebuild } = require('@electron/rebuild')
const path = require('path')
const fs = require('fs')

exports.default = async function afterPack(context) {
  const { appOutDir } = context
  const resourcesPath = path.join(appOutDir, 'resources')
  const backendPath = path.join(resourcesPath, 'backend')

  // Read the exact Electron version installed in this project
  const electronVersion = require('../node_modules/electron/package.json').version

  console.log(
    `\n[after-pack] Rebuilding better-sqlite3 for Electron ${electronVersion} in staging…`
  )

  try {
    // Only better-sqlite3 remains as a native module in the backend.
    // bcrypt has been replaced by pure-JS bcryptjs, ssh2/cpu-features build
    // their own prebuilt binaries and do not require an Electron ABI rebuild.
    await rebuild({
      buildPath: backendPath,
      electronVersion,
      onlyModules: ['better-sqlite3'],
      force: true,
      useCache: false
    })
    console.log('[after-pack] ✓ better-sqlite3 rebuilt successfully for Electron ABI.')

    // The rebuild leaves behind build artifacts (obj files, pdb, lib, sqlite3.c, etc.)
    // that are not needed at runtime. Only the .node binary is required.
    // Clean them up to avoid shipping ~68 MB of unnecessary build output.
    const bs3Path = path.join(backendPath, 'node_modules', 'better-sqlite3')
    const toRemove = [
      path.join(bs3Path, 'build', 'Release', 'obj'),
      path.join(bs3Path, 'build', 'deps'),
      path.join(bs3Path, 'build', 'Release', 'better_sqlite3.iobj'),
      path.join(bs3Path, 'build', 'Release', 'better_sqlite3.ipdb'),
      path.join(bs3Path, 'build', 'Release', 'better_sqlite3.pdb'),
      path.join(bs3Path, 'build', 'Release', 'sqlite3.lib'),
      path.join(bs3Path, 'build', 'Release', 'test_extension.pdb'),
      path.join(bs3Path, 'build', 'Release', 'test_extension.node'),
      path.join(bs3Path, 'deps', 'sqlite3', 'sqlite3.c'),
      path.join(bs3Path, 'deps', 'sqlite3', 'sqlite3.h')
    ]
    for (const p of toRemove) {
      try {
        fs.rmSync(p, { recursive: true, force: true })
      } catch (e) {
        console.warn(`[after-pack] Could not remove ${p}: ${e.message}`)
      }
    }
    const savedMB = 68
    console.log(`[after-pack] ✓ Cleaned better-sqlite3 build artifacts (~${savedMB} MB removed).\n`)
  } catch (err) {
    console.error('[after-pack] ✗ Native rebuild failed:', err.message || err)
    throw err // Fail the build so the installer is not created with the wrong binary
  }
}
