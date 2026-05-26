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

const { rebuild } = require('@electron/rebuild');
const path = require('path');

exports.default = async function afterPack(context) {
  const { appOutDir } = context;
  const resourcesPath = path.join(appOutDir, 'resources');
  const backendPath = path.join(resourcesPath, 'backend');

  // Read the exact Electron version installed in this project
  const electronVersion = require('../node_modules/electron/package.json').version;

  console.log(`\n[after-pack] Rebuilding better-sqlite3 for Electron ${electronVersion} in staging…`);

  try {
    await rebuild({
      buildPath: backendPath,
      electronVersion,
      onlyModules: ['better-sqlite3'],
      force: true,
      useCache: false,
    });
    console.log('[after-pack] ✓ better-sqlite3 rebuilt successfully for Electron ABI.\n');
  } catch (err) {
    console.error('[after-pack] ✗ Native rebuild failed:', err.message || err);
    throw err; // Fail the build so the installer is not created with the wrong binary
  }
};
