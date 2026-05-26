import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db';

export let prisma: PrismaClient;

export async function initDatabase(): Promise<void> {
  try {
    // Ensure env is set for migrate deploy
    process.env.DATABASE_URL = dbUrl;

    let prismaCliPath: string;
    let backendDir: string;
    try {
      const prismaPkgPath = require.resolve('prisma/package.json');
      prismaCliPath = path.join(path.dirname(prismaPkgPath), 'build/index.js');
      backendDir = path.join(path.dirname(prismaPkgPath), '../../');
    } catch (e) {
      // Fallbacks
      prismaCliPath = path.join(__dirname, '../../node_modules/prisma/build/index.js');
      backendDir = path.join(__dirname, '../../');
    }

    // Resolve writeable directory from database URL
    const dbFilePath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl;
    const userDataDir = path.dirname(dbFilePath);

    // Resolve paths to schema and migrations
    const schemaPath = path.join(backendDir, 'prisma/schema.prisma');
    const migrationsPath = path.join(backendDir, 'prisma/migrations');

    // Create a dynamic, writeable prisma.config.js for Prisma 7 migrations
    const configPath = path.join(userDataDir, 'prisma.config.js');
    const configContent = `
const { defineConfig } = require("prisma/config");

module.exports = defineConfig({
  schema: "${schemaPath.replace(/\\/g, '\\\\')}",
  migrations: {
    path: "${migrationsPath.replace(/\\/g, '\\\\')}",
  },
  datasource: {
    url: "${dbUrl.replace(/\\/g, '\\\\')}",
  },
});
`;

    console.log(`Writing dynamic Prisma config to: ${configPath}`);
    fs.writeFileSync(configPath, configContent.trim() + '\n', 'utf8');

    console.log(`Running database migrations using local Prisma CLI: ${prismaCliPath}`);

    const nodeModulesPath = path.join(backendDir, 'node_modules');
    const envNodePath = process.env.NODE_PATH 
      ? `${nodeModulesPath}${path.delimiter}${process.env.NODE_PATH}` 
      : nodeModulesPath;

    // Run using the current node executable (process.execPath) to avoid dependency on global Node.js/npx
    execSync(`"${process.execPath}" "${prismaCliPath}" migrate deploy --config "${configPath}"`, {
      env: { 
        ...process.env, 
        DATABASE_URL: dbUrl,
        NODE_PATH: envNodePath
      },
      stdio: 'inherit',
    });

    const adapter = new PrismaBetterSqlite3({ url: dbUrl });
    prisma = new PrismaClient({ adapter } as never);

    await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;');
    await prisma.$connect();
    console.log('DB ready:', dbUrl);

    // Run background log cleanup
    try {
      const config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } });
      if (config && config.logRetentionDays > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - config.logRetentionDays);
        const deleted = await prisma.auditLog.deleteMany({
          where: { timestamp: { lt: cutoffDate } }
        });
        if (deleted.count > 0) {
          console.log(`Cleaned up ${deleted.count} old audit logs.`);
        }
      }
    } catch (e) {
      console.error('Failed to run log cleanup:', e);
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}
