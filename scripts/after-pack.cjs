/**
 * scripts/after-pack.cjs
 *
 * Runs AFTER electron-builder stages all files (including extraResources)
 * but BEFORE the installer is created. better-sqlite3 13 ships N-API prebuilt
 * binaries for every platform (ADR-003), so nothing is rebuilt: this keeps
 * only the binary for the platform and architecture being packaged and
 * checks that it really is built for that architecture.
 *
 * The staged copy under the resources directory is changed, never the source
 * backend/node_modules that development and the tests use.
 */

const path = require('path')
const { assertBinaryArch, prunePrebuilds } = require('./native-prebuild.cjs')

// electron-builder reports the target architecture as its numeric Arch enum
// (see builder-util's Arch).
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

exports.default = async function afterPack(context) {
  const { appOutDir, arch, electronPlatformName, packager } = context

  // Ask electron-builder where resources landed rather than assuming
  // <appOutDir>/resources: on macOS extraResources go inside the bundle at
  // <appOutDir>/<productName>.app/Contents/Resources.
  const resourcesPath = packager.getResourcesDir(appOutDir)
  const bs3Path = path.join(resourcesPath, 'backend', 'node_modules', 'better-sqlite3')

  // Package for the architecture being built, not the one this machine is: on an
  // Apple Silicon runner the x64 bundle must still get the x64 binary.
  const targetArch = ARCH_NAMES[arch]
  if (targetArch !== 'x64' && targetArch !== 'arm64') {
    throw new Error(
      `[after-pack] Unsupported target arch "${targetArch ?? arch}" — better-sqlite3 ships x64 and ` +
        'arm64 prebuilds only. Package separate x64 and arm64 targets (no universal builds).'
    )
  }

  const kept = prunePrebuilds(bs3Path, electronPlatformName, targetArch)
  assertBinaryArch(kept, targetArch)
  console.log(
    `[after-pack] ✓ better-sqlite3: kept ${path.basename(kept)} (${targetArch}), no rebuild needed`
  )
}
