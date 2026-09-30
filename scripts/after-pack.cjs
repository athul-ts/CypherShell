/**
 * scripts/after-pack.cjs
 *
 * Runs AFTER electron-builder stages all files (including extraResources)
 * but BEFORE the installer is created. At this point, the staged copy of
 * backend/node_modules is in the staged resources dir — dist/win-unpacked/
 * resources/backend/ on Windows and Linux, or CypherShell.app/Contents/
 * Resources/backend/ on macOS — and is NOT locked by any running process, so
 * we can safely rebuild better-sqlite3 against Electron's ABI without
 * touching the source node_modules at all.
 *
 * This means:
 *  - dev mode: source backend/node_modules uses system Node.js ABI  → works
 *  - production: staged copy uses Electron ABI (rebuilt here)        → works
 *  - no EPERM: we never touch a file the dev server has open
 */

const { rebuild } = require('@electron/rebuild')
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

// electron-builder reports the target architecture as its numeric Arch enum
// (see builder-util's Arch).
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

/**
 * Assert that a compiled .node binary contains the architecture we asked for.
 * lipo lists every slice in a Mach-O file, so a universal binary reports
 * several. macOS only — lipo ships with the Xcode command line tools.
 *
 * A wrong-arch binary builds cleanly and only fails at runtime, on the user's
 * machine, so this is the only chance to catch it.
 */
function assertBinaryArch(binaryPath, targetArch) {
  let arches
  try {
    arches = execFileSync('lipo', ['-archs', binaryPath], { encoding: 'utf8' }).trim()
  } catch (err) {
    throw new Error(`[after-pack] Could not inspect ${binaryPath} with lipo: ${err.message}`)
  }
  if (!arches.split(/\s+/).includes(targetArch)) {
    throw new Error(
      `[after-pack] better_sqlite3.node is built for "${arches}" but the target is ` +
        `"${targetArch}" — it would crash on launch for the packaged platform.`
    )
  }
  console.log(`[after-pack] ✓ Verified better_sqlite3.node architecture: ${arches}`)
}

exports.default = async function afterPack(context) {
  const { appOutDir, arch, packager } = context

  // Ask electron-builder where resources landed rather than assuming
  // <appOutDir>/resources. That layout only holds on Windows and Linux; on
  // macOS extraResources go inside the bundle at
  // <appOutDir>/<productName>.app/Contents/Resources. Hardcoding it made every
  // macOS package fail here with ENOENT on backend/package.json.
  const resourcesPath = packager.getResourcesDir(appOutDir)
  const backendPath = path.join(resourcesPath, 'backend')

  // Rebuild for the architecture being packaged, not the one this machine
  // happens to be. On an Apple Silicon runner the x64 bundle must still get an
  // x86_64 binary, or it crashes on launch on Intel Macs.
  const targetArch = ARCH_NAMES[arch]
  if (!targetArch) {
    throw new Error(
      `[after-pack] Unrecognised target arch "${arch}" — expected one of ` +
        `${Object.values(ARCH_NAMES).join(', ')}`
    )
  }
  if (targetArch === 'universal') {
    throw new Error(
      '[after-pack] Universal macOS builds are not supported: better-sqlite3 is a native ' +
        'module that must be rebuilt per architecture, and @electron/rebuild cannot emit a ' +
        'universal binary. Package separate x64 and arm64 targets instead.'
    )
  }

  // Read the exact Electron version installed in this project
  const electronVersion = require('../node_modules/electron/package.json').version

  console.log(
    `\n[after-pack] Rebuilding better-sqlite3 for Electron ${electronVersion} (${targetArch}) in staging…`
  )

  try {
    // Only better-sqlite3 remains as a native module in the backend.
    // bcrypt has been replaced by pure-JS bcryptjs, ssh2/cpu-features build
    // their own prebuilt binaries and do not require an Electron ABI rebuild.
    await rebuild({
      buildPath: backendPath,
      electronVersion,
      arch: targetArch,
      onlyModules: ['better-sqlite3'],
      force: true,
      useCache: false
    })
    console.log('[after-pack] ✓ better-sqlite3 rebuilt successfully for Electron ABI.')

    const bs3Path = path.join(backendPath, 'node_modules', 'better-sqlite3')

    // A clean rebuild is not proof the binary matches the target arch.
    if (process.platform === 'darwin') {
      assertBinaryArch(path.join(bs3Path, 'build', 'Release', 'better_sqlite3.node'), targetArch)
    }

    // The rebuild leaves behind build artifacts (obj files, pdb, lib, sqlite3.c, etc.)
    // that are not needed at runtime. Only the .node binary is required.
    // Clean them up to avoid shipping ~68 MB of unnecessary build output.
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
