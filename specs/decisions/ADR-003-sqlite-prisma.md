# ADR-003 — Use SQLite + Prisma ORM for persistence

**Date:** 2026-05-01
**Status:** Accepted
**Deciders:** Athul T S

---

## Context

CypherShell stores connection profiles, SSH keys, port forwarding rules, app config, and audit logs. Persistence options considered:

1. **SQLite + Prisma** — embedded relational DB, zero install
2. **SQLite + raw `better-sqlite3`** — same DB, no ORM
3. **JSON flat files** — one JSON file per entity type
4. **LevelDB / lowdb** — embedded key-value store
5. **Cloud database (PostgreSQL/MySQL)** — hosted, requires network

## Decision

Use **SQLite** with **Prisma ORM** and **better-sqlite3** as the driver.

## Reasoning

**Why SQLite:**
This is a desktop app. There is no deployment server. The database must be zero-install, self-contained, and portable. The user's data must live entirely on their machine — a cloud DB would require credentials, network access, and create privacy concerns around SSH credentials.

SQLite is the right answer for any application that needs relational storage and runs on the user's machine. It is literally designed for this use case.

**Why Prisma over raw SQL:**
- **Type safety:** Prisma generates a full TypeScript client from `schema.prisma`. All queries are type-checked at compile time — no string-typed SQL and no runtime schema drift.
- **Migrations:** `prisma migrate` tracks schema changes as SQL migration files and applies them atomically at startup (`prisma migrate deploy`). Adding a column never requires manual SQL.
- **Schema as source of truth:** `schema.prisma` is the single place that defines the data model. All types in controllers and services are derived from it — there is no duplication between SQL DDL and TypeScript interfaces.
- **Readable query syntax:** `prisma.profile.findMany({ where: { group: 'Production' } })` is far more readable and refactorable than a prepared statement string.

**Why `better-sqlite3` (not the default Prisma SQLite driver):**
Prisma's default SQLite driver uses a WASM build that has compatibility issues with Electron's sandboxed renderer. `better-sqlite3` is a native Node.js binding that works cleanly with Electron's bundled Node.js runtime after the ABI rebuild step.

**WAL mode:** Enabled on every startup via `PRAGMA journal_mode=WAL`. This prevents database corruption on force-quit (common in desktop apps) and improves concurrent read performance.

## Consequences

- **Positive:** Zero-install — the `.db` file is created automatically on first run in `app.getPath('userData')`
- **Positive:** Fully type-safe queries — schema changes that break existing queries are caught at build time
- **Positive:** Portable — user backup is simply copying the `.db` file
- **Negative:** `better-sqlite3` is a native module — must be rebuilt for Electron's Node ABI via `npm run rebuild:native` after `npm install` or Electron version changes
- **Negative:** Prisma client must be regenerated (`npx prisma generate`) after every schema change
- **Negative:** No multi-process write concurrency — only the Express backend writes to the DB; the renderer never has direct DB access (this is by design)

## Related

- `backend/prisma/schema.prisma` — the single source of truth for the data model
- `backend/src/config/db.ts` — `initDatabase()`: runs `prisma migrate deploy` + enables WAL
- `backend/src/services/` — all DB access is through service files, never in controllers
- `scripts/rebuild-native.cjs` — rebuilds `better-sqlite3` for the current Electron ABI
- `SRS_SSH_Desktop_App.md §8` — full database schema documentation
