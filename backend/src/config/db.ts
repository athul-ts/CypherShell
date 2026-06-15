import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db'

export let prisma: PrismaClient

/**
 * Locate the prisma/migrations directory in both dev and packaged layouts.
 *  - dev:        backend/src/config/db.ts  → ../../prisma/migrations
 *  - production: backend/dist/index.js     → ../prisma/migrations
 */
function resolveMigrationsDir(): string | null {
  const candidates = [
    path.join(__dirname, '../prisma/migrations'),
    path.join(__dirname, '../../prisma/migrations')
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

/**
 * Apply pending Prisma migrations directly against the SQLite database using
 * better-sqlite3. This replaces shelling out to the Prisma CLI (`migrate
 * deploy`) at runtime, which would require bundling the entire CLI dependency
 * tree (@prisma/engines, @prisma/fetch-engine, @prisma/config, effect, …).
 *
 * The `_prisma_migrations` bookkeeping table mirrors Prisma's own format so
 * the schema stays compatible with the Prisma toolchain in development.
 */
function applyMigrations(dbFilePath: string): void {
  const migrationsDir = resolveMigrationsDir()
  if (!migrationsDir) {
    console.warn('No migrations directory found; skipping migration step.')
    return
  }

  const db = new Database(dbFilePath)
  try {
    db.pragma('journal_mode = WAL')
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id"                    TEXT PRIMARY KEY NOT NULL,
      "checksum"              TEXT NOT NULL,
      "finished_at"           DATETIME,
      "migration_name"        TEXT NOT NULL,
      "logs"                  TEXT,
      "rolled_back_at"        DATETIME,
      "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
    );`)

    const appliedRows = db
      .prepare('SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL')
      .all() as Array<{ migration_name: string }>
    const applied = new Set(appliedRows.map((r) => r.migration_name))

    const migrationNames = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()

    for (const name of migrationNames) {
      if (applied.has(name)) continue

      const sqlPath = path.join(migrationsDir, name, 'migration.sql')
      if (!fs.existsSync(sqlPath)) continue

      const sql = fs.readFileSync(sqlPath, 'utf8')
      const checksum = crypto.createHash('sha256').update(sql).digest('hex')
      const id = crypto.randomUUID()

      const runMigration = db.transaction(() => {
        db.exec(sql)
        db.prepare(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
           VALUES (?, ?, current_timestamp, ?, current_timestamp, 1)`
        ).run(id, checksum, name)
      })
      runMigration()
      console.log(`Applied migration: ${name}`)
    }
  } finally {
    db.close()
  }
}

export async function initDatabase(): Promise<void> {
  try {
    process.env.DATABASE_URL = dbUrl

    const dbFilePath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl

    // Apply any pending migrations before opening the Prisma client.
    applyMigrations(dbFilePath)

    const adapter = new PrismaBetterSqlite3({ url: dbUrl })
    prisma = new PrismaClient({ adapter } as never)

    await prisma.$connect()
    console.log('DB ready:', dbUrl)

    // Run background log cleanup
    try {
      const config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } })
      if (config && config.logRetentionDays > 0) {
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - config.logRetentionDays)
        const deleted = await prisma.auditLog.deleteMany({
          where: { timestamp: { lt: cutoffDate } }
        })
        if (deleted.count > 0) {
          console.log(`Cleaned up ${deleted.count} old audit logs.`)
        }
      }
    } catch (e) {
      console.error('Failed to run log cleanup:', e)
    }
  } catch (error) {
    console.error('Database initialization failed:', error)
    process.exit(1)
  }
}
