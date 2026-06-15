// esbuild bundle script — replaces plain tsc for the production build.
// Pure-JS deps are inlined; native modules and Prisma are left external
// so they continue to be resolved from backend/node_modules at runtime.
const esbuild = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')

// Remove any previous build output (including stale multi-file tsc output)
// so the packaged backend/dist contains only the single esbuild bundle.
fs.rmSync(path.join(__dirname, 'dist'), { recursive: true, force: true })

esbuild
  .build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/index.js',
    format: 'cjs',
    sourcemap: false,
    external: [
      // Native modules — cannot be bundled, must live in node_modules
      'better-sqlite3',
      'ssh2',
      'cpu-features',
      // Prisma — dynamic file loading and pre-built query engine binary
      '@prisma/client',
      '@prisma/adapter-better-sqlite3'
    ]
  })
  .catch(() => process.exit(1))
