import { defineConfig } from 'vitest/config'
import path from 'path'
import { createRequire } from 'module'

// Require context rooted at backend/ so bare imports (express, @prisma/client, …)
// resolve from backend/node_modules instead of the root node_modules.
const backendRequire = createRequire(path.resolve('backend/package.json'))
const backendModulesDir = path.join(path.resolve('backend/node_modules'), path.sep)

/**
 * Vite plugin: resolve bare-specifier imports that live only in
 * backend/node_modules (express, cors, bcryptjs, ssh2, etc.)
 *
 * A specifier is only claimed when it actually resolves *inside*
 * backend/node_modules. `createRequire` also walks up to the root
 * node_modules, and `require.resolve` then picks a package's `require`
 * condition — so an unguarded `backendRequire.resolve('vitest')` would return
 * root `vitest/index.cjs`, whose only job is to throw and tell you to use
 * ESM. Those specifiers must fall through to Vite's own resolver instead.
 */
const resolveBackendDeps = {
  name: 'resolve-backend-deps',
  enforce: 'pre' as const,
  resolveId(id: string): string | null {
    if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0')) return null
    try {
      const resolved = backendRequire.resolve(id)
      return resolved.startsWith(backendModulesDir) ? resolved : null
    } catch {
      return null // not in backend/node_modules — let Vite's default resolution try root
    }
  }
}

export default defineConfig({
  plugins: [resolveBackendDeps],
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    include: ['tests/backend/**/*.test.ts'],
    // One fork at a time: prevents concurrent SQLite writes on the shared test.db.
    // Each file gets its own process so the `prisma` singleton is isolated per file.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    env: {
      DATABASE_URL: `file:${path.resolve('tests/backend/test.db')}`,
      JWT_SECRET: 'vitest-test-secret'
    },
    setupFiles: ['tests/backend/helpers/setup.ts']
  }
})
