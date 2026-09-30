/**
 * Vitest setupFile for backend tests.
 * Runs once (singleFork + isolate:false) before all backend test files.
 * DATABASE_URL and JWT_SECRET are already injected by vitest.config env option.
 */
import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll } from 'vitest'

const dbPath = path.resolve('tests/backend/test.db')

beforeAll(async () => {
  // Clean slate: remove any leftover test DB from a previous run.
  fs.rmSync(dbPath, { force: true })
  fs.rmSync(`${dbPath}-shm`, { force: true })
  fs.rmSync(`${dbPath}-wal`, { force: true })

  // Import AFTER env vars are set (they are, via vitest config `env`).
  const { initDatabase } = await import('../../../backend/src/config/db')
  await initDatabase()
}, 30000)

afterAll(async () => {
  try {
    const { prisma } = await import('../../../backend/src/config/db')
    await prisma.$disconnect()
  } catch {
    // best-effort
  }
  fs.rmSync(dbPath, { force: true })
  fs.rmSync(`${dbPath}-shm`, { force: true })
  fs.rmSync(`${dbPath}-wal`, { force: true })
})
