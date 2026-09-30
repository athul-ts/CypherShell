# ADR-002 — Spawn Express as a child process for backend logic

**Date:** 2026-05-01
**Status:** Accepted
**Deciders:** Athul T S

---

## Context

CypherShell needs a backend to handle SSH sessions, SFTP operations, database access, and key management. There were two main architectural options:

1. **Spawn an Express server** as a child process from the Electron main process, and have the renderer call it via HTTP/WebSocket
2. **Use Electron IPC exclusively** — all backend logic lives in the main process, renderer calls it via `ipcRenderer.invoke`

## Decision

Spawn an **Express 4 server** as a child process bound to `127.0.0.1:{auto-port}`.

## Reasoning

Pure IPC has significant limitations:

- **WebSocket not possible over IPC** — xterm.js bidirectional streaming requires a real WebSocket. Simulating it over IPC channels produces high latency and lacks native binary framing.
- **SSE not possible over IPC** — SFTP transfer progress streaming uses Server-Sent Events (`text/event-stream`). This cannot be replicated over Electron IPC without custom polling infrastructure.
- **Separation of concerns** — The Express backend can be developed, tested, and reasoned about independently of the Electron shell. The backend has its own `package.json`, its own TypeScript config, and can in principle be swapped or tested in isolation.
- **Familiar HTTP/REST surface** — Controllers, services, middleware, and route files are standard Express patterns any Node.js developer understands. IPC handler files have no community-standard structure.
- **Prisma works naturally** — Prisma expects to run in a Node.js environment. In the main process it works, but the ORM, migrations, and client generation fit more naturally in a standalone backend project.

The security concern — "an external process means an open network port" — is addressed by binding exclusively to `127.0.0.1`. The port is auto-selected by `portfinder` at startup to avoid conflicts. No external network connection to the backend is possible.

## Consequences

- **Positive:** WebSocket and SSE work natively — no workarounds for terminal streaming or SFTP progress
- **Positive:** Backend is testable independently of Electron
- **Positive:** Clean separation: renderer calls HTTP APIs; Electron IPC is only used for native OS features (file dialogs, window management, auto-updater)
- **Negative:** App startup requires spawning the child process and waiting for it to be ready (health-check poll on `GET /api/health`)
- **Negative:** The port must be communicated from main → renderer via IPC (`get-backend-port` channel)
- **Negative:** Native modules (`better-sqlite3`) must be rebuilt for the Electron Node.js ABI via `npm run rebuild:native`

## Related

- `src/main/index.ts` — spawns the backend child process, passes port via `get-backend-port` IPC channel
- `backend/src/index.ts` — Express server entry, binds to `127.0.0.1`
- `backend/src/config/env.ts` — reads PORT from environment
- `src/preload/index.ts` — exposes `backendPort` to the renderer
- `SRS_SSH_Desktop_App.md §4.1` — Main Process documentation
