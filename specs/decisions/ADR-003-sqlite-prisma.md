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
- **Migrations:** `prisma migrate dev` tracks schema changes as versioned SQL files during development. In the packaged app, migrations are applied at startup directly via `better-sqlite3` (see "Migration strategy" below) — no Prisma CLI required at runtime.
- **Schema as source of truth:** `schema.prisma` is the single place that defines the data model. All types in controllers and services are derived from it — there is no duplication between SQL DDL and TypeScript interfaces.
- **Readable query syntax:** `prisma.profile.findMany({ where: { group: 'Production' } })` is far more readable and refactorable than a prepared statement string.

**Migration strategy (dev vs. packaged):**

| Environment               | How migrations run                                                                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development               | `npx prisma migrate dev` (normal Prisma CLI workflow)                                                                                                                                                                                                                |
| Packaged app (production) | `initDatabase()` reads the SQL files from `prisma/migrations/` and applies any unapplied migrations via `better-sqlite3`, writing bookkeeping rows to `_prisma_migrations` in the same format Prisma uses — so the schema stays compatible with the Prisma toolchain |

This approach eliminates the need to ship the Prisma CLI (`prisma` package), `@prisma/engines` (schema-engine binary), `@prisma/fetch-engine`, `@prisma/config`, and their transitive dependencies (including the `effect` library at 31 MB) — reducing the Windows installer by an additional ~40 MB.

**Why `better-sqlite3` (not the default Prisma SQLite driver):**
Prisma's default SQLite driver uses a WASM build that has compatibility issues with Electron's sandboxed renderer. `better-sqlite3` is a native Node.js binding that works cleanly with Electron's bundled Node.js runtime after the ABI rebuild step.

**WAL mode:** Enabled on every startup via `PRAGMA journal_mode=WAL`. This prevents database corruption on force-quit (common in desktop apps) and improves concurrent read performance.

## Consequences

- **Positive:** Zero-install — the `.db` file is created automatically on first run in `app.getPath('userData')`
- **Positive:** Fully type-safe queries — schema changes that break existing queries are caught at build time
- **Positive:** Portable — user backup is simply copying the `.db` file
- **Negative:** `better-sqlite3` is a native module. Until BL-36 it was rebuilt for Electron's Node ABI by `scripts/after-pack.cjs` during packaging; from BL-36 it ships N-API prebuilds (see the update below)
- **Negative:** Prisma client must be regenerated (`npx prisma generate`) after every schema change
- **Negative:** No multi-process write concurrency — only the Express backend writes to the DB; the renderer never has direct DB access (this is by design)
- **Negative:** `binaryTargets = ["native"]` in `schema.prisma` means cross-compiling (e.g. building on macOS for Windows) requires regenerating the client on the target platform

## Update — 2026-11-20: N-API prebuilds instead of an Electron rebuild (BL-36)

**Context.** Electron 45 (needed because Electron 39 is out of support) changes V8 APIs that `better-sqlite3` 12 uses (`Object::GetPrototypeV2`, `External::Value()`), so the Electron-ABI rebuild no longer compiles. `better-sqlite3` 13 moved to N-API (`NAPI_VERSION=10`) and publishes prebuilt binaries inside the npm package for `win32`, `darwin` and `linux` (glibc and musl) on x64 and arm64; it has no install script (`gypfile: false`).

**Decision.** Use `better-sqlite3` ^13.2.0 and drop the Electron-ABI rebuild entirely. Packaging keeps only the target platform's prebuild, removes any locally compiled `build/` directory, and checks the binary's architecture from its header.

**Verified on 2026-11-20 (Windows):** the same binary passes the whole backend suite on Node 24 and loads and queries under Electron 45.4.1 (Node 24.22.3, ABI 150; SQLite 3.54.1). The Linux prebuilds require glibc 2.34 (`GLIBCXX_3.4.29`); the macOS prebuilds target macOS 10.7 (x64) and 11.0 (arm64).

**Consequences.**

- **Positive:** one binary for tests, development and the packaged app — the `NODE_MODULE_VERSION` mismatch between system Node and Electron disappears, and no compiler is needed to build or package.
- **Positive:** an Electron upgrade no longer needs a native rebuild, as long as its Node supports N-API 10.
- **Negative:** `@prisma/adapter-better-sqlite3` 7.10 declares `better-sqlite3 ^12.6.0`; the app forces 13 with an npm `overrides` entry. The backend suite covers the queries the app makes; the override is removed when Prisma widens its range.
- **Negative:** Linux now needs glibc 2.34 (Ubuntu 22.04 or later); Ubuntu 20.04 is no longer supported.
- **Negative:** the loader prefers a locally compiled `build/Release/better_sqlite3.node` over the prebuild, so a stray build directory must never be packaged — `after-pack.cjs` deletes it.

## Related

- `backend/prisma/schema.prisma` — the single source of truth for the data model
- `backend/src/config/db.ts` — `initDatabase()`: applies pending migrations via `better-sqlite3`, then opens Prisma client
- `backend/src/services/` — all DB access is through service files, never in controllers
- `scripts/after-pack.cjs` — keeps only the target's `better-sqlite3` prebuild and checks its architecture (BL-36; earlier versions rebuilt it for the Electron ABI)
- `SRS_SSH_Desktop_App.md §8` — full database schema documentation
