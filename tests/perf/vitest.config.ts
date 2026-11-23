import { defineConfig } from 'vitest/config'
import base from '../backend/vitest.config'

/**
 * BL-45 / NFR-01: the same environment as the backend tests (resolver, test database, launch
 * secret) with its own file pattern. Run with `npm run test:perf`.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/perf/**/*.perf.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000
  }
})
