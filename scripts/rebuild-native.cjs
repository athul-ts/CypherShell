/**
 * scripts/rebuild-native.cjs
 *
 * Rebuilds backend native modules (better-sqlite3) against Electron's
 * bundled Node.js ABI so they can be loaded by ELECTRON_RUN_AS_NODE=1
 * in the packaged app without a version mismatch crash.
 */

const { rebuild } = require('@electron/rebuild');
const path = require('path');
const electronPkg = require('../node_modules/electron/package.json');

const electronVersion = electronPkg.version;
console.log(`Rebuilding native modules for Electron ${electronVersion}…`);

rebuild({
  buildPath: path.resolve(__dirname, '../backend'),
  electronVersion,
  onlyModules: ['better-sqlite3'],
  force: true,
  useCache: false,
})
  .then(() => {
    console.log('✓ Native modules rebuilt successfully.');
  })
  .catch((err) => {
    console.error('✗ Rebuild failed:', err.message || err);
    process.exit(1);
  });
