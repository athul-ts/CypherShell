# CypherShell — Claude Code Instructions

## Spec-Driven Development (SDD) — MANDATORY

CypherShell follows strict spec-driven development. **The spec always comes before the code.**

### The Rule

Every code change must trace to a requirement in `SRS_SSH_Desktop_App.md`.
Every commit message must include the spec ID (e.g. `feat(sftp): cancel transfer [BL-01]`).

### Workflow for implementing a feature

1. **Read the spec first** — find the requirement ID in `specs/index.md`, then read its full section in `SRS_SSH_Desktop_App.md`
2. **Check status** — if it is ✅ already, do not re-implement; if ⚠️, read what partial work exists first
3. **Implement** — follow the coding conventions below
4. **Update status** — mark the item ✅ in both `specs/index.md` AND `SRS_SSH_Desktop_App.md`
5. **Commit** — include the spec ID in the commit message

### Workflow for adding a new requirement

1. **Spec first, code never** — do not write a single line of implementation code before the spec exists
2. Copy `specs/templates/fr-template.md` and fill it in completely
3. Add the new FR to `SRS_SSH_Desktop_App.md` in the right section
4. Add the entry to `specs/index.md`
5. Only then implement

### Quick spec reference

- **Master index:** `specs/index.md` — all FR/NFR/BL IDs, statuses, and SRS section links
- **Full spec:** `SRS_SSH_Desktop_App.md` — complete requirement text with implementation notes
- **Architecture decisions:** `specs/decisions/` — ADR-001, ADR-002, ADR-003
- **Templates:** `specs/templates/` — use these when adding new requirements or decisions

### Slash commands for SDD workflow

- `/spec-implement <ID>` — implement a spec item end-to-end and update its status
- `/spec-new` — formally add a new requirement before coding it
- `/spec-check` — audit the codebase against the spec and report drift

---

## Project Overview

CypherShell is a cross-platform SSH desktop client built with Electron 39, React 19, TypeScript, and an Express 4 backend. It supports SSH terminal sessions, SFTP file management, SSH key management, port forwarding, and a master-password-based app lock.

## Architecture — Three Processes

```
Electron Main (src/main/index.ts)
  └── spawns → Express Backend (backend/src/index.ts)  [child_process, port auto-selected by portfinder]
  └── loads  → Renderer (src/renderer/src/)             [React 19 SPA via electron-vite]
```

- The renderer communicates with the backend via **Axios** over `http://127.0.0.1:<port>` and **WebSocket** for terminal I/O.
- The main process and renderer communicate via **contextBridge** IPC (see `src/preload/index.ts`).
- The backend binds to `127.0.0.1` only — never `0.0.0.0`.

## Key File Locations

| Layer                | Path                                             |
| -------------------- | ------------------------------------------------ |
| Electron main        | `src/main/index.ts`                              |
| Preload / IPC bridge | `src/preload/index.ts`, `src/preload/index.d.ts` |
| React SPA root       | `src/renderer/src/App.tsx`                       |
| Pages                | `src/renderer/src/pages/`                        |
| Components           | `src/renderer/src/components/`                   |
| Zustand stores       | `src/renderer/src/store/`                        |
| React hooks          | `src/renderer/src/hooks/`                        |
| API client (Axios)   | `src/renderer/src/lib/api.ts`                    |
| Backend entry        | `backend/src/index.ts`                           |
| Backend routes       | `backend/src/routes/`                            |
| Backend controllers  | `backend/src/controllers/`                       |
| Backend services     | `backend/src/services/`                          |
| Prisma schema        | `backend/prisma/schema.prisma`                   |
| WebSocket handler    | `backend/src/websocket/terminal.ws.ts`           |

## Tech Stack (exact versions)

- Electron 39, electron-vite 5, electron-builder 26, electron-updater 6.8
- React 19, React Router v7 (HashRouter — required for `file://`)
- Tailwind CSS 3.4, shadcn/ui (Radix primitives, copy-owned in `components/ui/`)
- Zustand 5, TanStack Query v5, xterm.js v6
- Express 4, Prisma ORM + better-sqlite3 (WAL mode)
- ssh2 + ssh2-sftp-client, node-forge + sshpk
- AES-256-GCM encryption at rest, PBKDF2-SHA512 (200k iterations), bcrypt cost 12, JWT 8h

## Development Commands

```bash
# Full dev mode (rebuilds native modules first)
npm run dev

# Type-check both processes
npm run typecheck

# Lint
npm run lint

# Format
npm run format

# Build backend only
npm run build:backend

# Package for current platform
npm run build:win    # or build:mac / build:linux
```

## Backend-Specific Commands (run inside `backend/`)

```bash
cd backend
npx prisma migrate dev --name <migration-name>   # create + apply migration
npx prisma migrate deploy                         # apply pending migrations (production)
npx prisma studio                                 # visual DB browser
npm run build                                     # compile backend TS → dist/
```

## Coding Conventions

- **TypeScript strict mode** everywhere — no `any` without a comment explaining why.
- **No barrel `index.ts` re-exports** in components — import directly from the file.
- **React components**: functional only, no class components.
- **State**: Zustand for client UI state; TanStack Query for server state (profiles, keys, logs). Do not mix them.
- **API calls**: always go through `src/renderer/src/lib/api.ts` (the configured Axios instance), never raw `fetch`.
- **IPC**: never add new IPC channels without updating both `src/preload/index.ts` AND `src/preload/index.d.ts`.
- **Prisma**: never mutate the DB outside of a service file in `backend/src/services/`.
- **Crypto**: all encrypt/decrypt must go through `backend/src/services/crypto.service.ts`.
- **No `console.log`** in committed code — use structured logger if needed.
- **Tailwind only** for styling — no inline `style={{}}` except for dynamic pixel values.
- **shadcn/ui**: components live in `src/renderer/src/components/ui/` — do not import from `@shadcn` directly.

## Security Rules (never violate)

- Never bind the Express server to `0.0.0.0`.
- Never expose the raw master password or derived key beyond the auth unlock flow in `backend/src/controllers/auth.controller.ts`.
- Never store decrypted private keys anywhere — decrypt in memory on use only.
- Never pass user-supplied paths directly to `fs` without normalizing and validating against allowed base directories.
- Never skip JWT middleware on any route except `POST /api/auth/unlock` and `POST /api/auth/setup`.
- Context isolation is ON — never set `contextIsolation: false` or `nodeIntegration: true` in webPreferences.

## v1.1 Backlog (features not yet implemented)

See `SRS_SSH_Desktop_App.md §17` for full details with implementation notes.
| ID | Feature | Priority |
|---|---|---|
| BL-01 | Cancel in-progress SFTP transfer | High |
| BL-02 | Port conflict detection before tunnel bind | Medium |
| BL-03 | Warn before deleting SSH key used by profiles | Medium |
| BL-04 | Audit log auto-purge scheduler | Medium |
| BL-05 | SSH disconnect reason in audit log | Low |
| BL-06 | DELETE /api/logs clear-all endpoint | Low |
| BL-07 | SFTP keyboard shortcuts (F2, Ctrl+Shift+N) | Low |
| BL-08 | Terminal right-click paste | Low |

## Common Pitfalls

- **Native module rebuild**: If you get `NODE_MODULE_VERSION` errors, run `npm run rebuild:native` from the project root.
- **Prisma client out of sync**: Run `npx prisma generate` inside `backend/` after any schema change.
- **Port already in use**: The backend port is auto-selected by `portfinder` starting at 3000 — kill any stale process if needed.
- **HashRouter is intentional**: React Router uses `HashRouter` (not `BrowserRouter`) because the renderer loads via `file://`. Never change this.
- **electron-vite aliases**: Path alias `@renderer` maps to `src/renderer/src/` — use it in renderer imports.
