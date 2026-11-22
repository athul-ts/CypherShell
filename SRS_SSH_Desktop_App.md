# Software Requirements Specification (SRS)

## CypherShell — Secure SSH Desktop Client

**Version:** 3.7
**Author:** Athul T S
**Date:** 2026-11-22
**Status:** Living Document — v1.0 Feature Complete, v1.1 Backlog Active (BL-10 … BL-16 implemented 2026-11-10; BL-17 … BL-28 implemented 2026-11-11)

> **Changelog from v3.6:**
>
> - BL-47 (2026-11-22): local files by grant — the backend no longer accepts local paths; the main process grants the files and folders the user picks (native dialogs, OS drops, local-pane listings) and resolves each grant for the backend (ADR-006). It closes the CodeQL path-injection alerts on PR #23 and the related drop and file-name defects

> **Changelog from v3.5:**
>
> - Phases 4–5 (2026-11-20): BL-36 … BL-46 specified — dependency security and the Electron 45 upgrade, CI on every branch, SSH host-key verification (FR-11), change master password (FR-07.8), keyboard-interactive login (new FR-01.9), automatic SSH reconnect (FR-02.6), thin controllers, logging, cleanup, performance checks (NFR-01) and the utility-process/fuses hardening (ADR-005, proposed)
> - FR-11.5 reworded to what the backend can observe (prompted, trusted, blocked, removed); the stale BL-02 "not built" note is corrected

> **Changelog from v3.4:**
>
> - Phase 3 (2026-11-18): BL-29 … BL-35 specified for the remaining ⚠️ functional gaps — terminal resize/reconnect, SFTP drag-in/retry/folder delete/paths, last-connected and form validation, audit reasons/paging/CSV safety, key overwrite in place, saved tunnel rules, light theme and bundled font

> **Changelog from v3.3:**
>
> - Phase 2 security hardening (2026-11-11): BL-17 … BL-26 specified (2026-11-10) and implemented, each with regression tests. They close the NFR-02 additions — local-API caller authentication, token revocation on every transport and real locking, in-memory JWT secret, no token in window URLs, window and IPC hardening, dialog-bound file IPC, request validation — plus a macOS update notice (NFR-07), a single app instance (NFR-03) and a 10-character master password (FR-07.1)
> - FR-02.9 and FR-07.5 are ✅ again; §4.1 / §4.2 IPC surface, §9 API notes and §10 security requirements updated to match
> - BL-27 (test-only, found while verifying Phase 2): the Playwright e2e suite runs on a throwaway `--user-data-dir` profile instead of the user's real one; NFR-06 states the rule
> - BL-28: the audit-log CSV export (FR-08.6) works again — the Logs page fetches the CSV with the session token and saves it through `dialog:saveTextFile`, and every CSV text field is quoted

> **Changelog from v3.2:**
>
> - Spec audit (2026-11-10): §6 status badges reconciled with `specs/index.md` and with the code. Requirements whose implementation was found broken are now ⚠️ and link to new backlog items BL-10 … BL-16 (§17); smaller gaps are recorded as ⚠️ notes on their requirement
> - Added FR-07.7 (lock-mode changes preserve encrypted data), FR-07.8 (change master password ❌), FR-11 (SSH host-key verification ❌) and NFR-02 additions (local-API caller authentication ❌, token revocation on every transport ❌)
> - Corrected facts: Express 5 (not 4), `bcryptjs`, 1-hour JWT, actual API routes (§9), IPC surface (§4.1–4.2), folder tree (§5), Prisma 7 datasource (§8.1), shadcn usage (§11.5); removed the non-existent system tray and main-process health-check poll
> - Recorded NFR-07 (Release & Distribution, added 2026-09-30)
> - Implemented BL-10 … BL-16 the same day, each with regression tests (in-process SSH server fixture, real app factory); §6 and §16 updated accordingly

> **Changelog from v3.1:**
>
> - Added FR-09: Profile Export/Import (data portability — no key material in profile export)
> - Added FR-10: SSH Key Export/Import (encrypted .cskb bundle with user-supplied passphrase)

> **Changelog from v3.0:**
>
> - Updated §8.0: migration strategy now uses `better-sqlite3` directly at runtime (no Prisma CLI)
> - Updated §8.1: `binaryTargets = ["native"]` (was multi-platform list)
> - Updated §15 risk table: resolved "bundle > 200 MB" (101 MB installer) and "Prisma engine binary" risks
> - Updated §16: build pipeline note — Windows installer ~101 MB via esbuild + direct migrations
> - Updated §14 Phase 5 deliverable: installer size optimization note added
> - Synced ADR-003 with new migration strategy and `after-pack.cjs` rebuild approach

> **Changelog from v2.0:**
>
> - Corrected all tech stack versions to match actual implementation
> - Updated folder structure to match current codebase
> - Updated API design with all actual routes (config, audit, tunnel)
> - Marked all development phases with completion status
> - Added §16 Implementation Status (complete gap analysis)
> - Added §17 v1.1 Backlog (unimplemented SRS requirements)
> - Updated DB schema to match live Prisma schema

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [Tech Stack Decision](#3-tech-stack-decision)
4. [System Architecture](#4-system-architecture)
5. [Folder Structure](#5-folder-structure)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Database Schema (SQLite + Prisma)](#8-database-schema-sqlite--prisma)
9. [API Design](#9-api-design)
10. [Security Requirements](#10-security-requirements)
11. [UI/UX Requirements](#11-uiux-requirements)
12. [Development Phases](#12-development-phases)
13. [Dependencies & Libraries](#13-dependencies--libraries)
14. [Out of Scope (v1)](#14-out-of-scope-v1)
15. [Known Risks](#15-known-risks)
16. [Implementation Status](#16-implementation-status)
17. [v1.1 Backlog — Unimplemented Requirements](#17-v11-backlog--unimplemented-requirements)

---

## 1. Introduction

### 1.1 Purpose

This document defines the complete software requirements for **CypherShell** — a desktop SSH client application and modern alternative to Bitvise SSH Client, MobaXterm, and PuTTY. It is built using electron-vite, React, TypeScript, Tailwind CSS, shadcn/ui, and a local Express.js backend. This is the single source of truth for all development, architecture decisions, and feature scope.

### 1.2 Project Goal

Build a cross-platform desktop SSH client that allows users to:

- Connect to remote servers via SSH
- Manage files via SFTP
- Forward ports (local, remote, dynamic SOCKS5)
- Manage SSH keys (generate, import, store securely)
- Maintain multiple concurrent sessions in tabs
- Save and reuse connection profiles securely
- Audit all activity with exportable logs

### 1.3 Why This Stack (Not Next.js)

Next.js was considered and rejected. All of its primary value — SSR, Server Components, Server Actions, API Routes, Image Optimization — is completely useless inside an Electron shell. Using Next.js in Electron means paying the full weight and complexity cost of a web framework while using it as nothing more than a plain React SPA.

`electron-vite` is the community-standard build toolchain for Electron + React desktop apps. It handles main process, preload scripts, and renderer (React + Vite) in a single unified config — purpose-built for exactly this use case.

### 1.4 Definitions & Acronyms

| Term          | Meaning                                                            |
| ------------- | ------------------------------------------------------------------ |
| SSH           | Secure Shell Protocol                                              |
| SFTP          | SSH File Transfer Protocol                                         |
| SRS           | Software Requirements Specification                                |
| IPC           | Inter-Process Communication (Electron main ↔ renderer)             |
| PTY           | Pseudo-terminal — required for interactive SSH shell               |
| xterm.js      | In-browser terminal emulator library (used by VS Code)             |
| ssh2          | Node.js SSH client library                                         |
| AES-256-GCM   | Advanced Encryption Standard, 256-bit Galois/Counter Mode          |
| JWT           | JSON Web Token                                                     |
| electron-vite | Build tool for Electron apps using Vite as the bundler             |
| Prisma        | Type-safe ORM with auto-generated TypeScript client                |
| shadcn/ui     | Copy-owned Radix UI primitives styled with Tailwind CSS            |
| SSE           | Server-Sent Events — one-way HTTP streaming from server to browser |

### 1.5 Scope

v1. Desktop-only Electron app:

- React (Vite) renderer for all UI
- Local Express.js backend spawned by Electron main for SSH/SFTP/DB
- SQLite as the embedded database (zero user installation required)
- Everything runs on the user's machine — no cloud dependency

---

## 2. Overall Description

### 2.1 Product Perspective

Fully standalone desktop application. Runtime architecture:

```
[React UI — Vite renderer in Electron window]
        ↓ WebSocket (SSH terminal) / REST (everything else) / SSE (SFTP progress)
[Local Express.js server — spawned by Electron main on localhost]
        ↓ ssh2
[Remote Linux/Unix Servers via SSH Protocol]
```

No external servers. No cloud. No installation of dependencies by the end user.

### 2.2 User Class

**Solo Developer / DevOps Engineer / System Administrator**
A technically proficient user who manages remote Linux/Unix servers and wants a polished GUI alternative to PuTTY, MobaXterm, or Bitvise — without being forced to the CLI for file transfers, key management, or tunnel configuration.

### 2.3 Operating Environment

| Item         | Detail                                                             |
| ------------ | ------------------------------------------------------------------ |
| OS           | Windows 10+, macOS 13+, Ubuntu 22.04+ (glibc 2.34)                 |
| Architecture | x64, ARM64 (Apple Silicon)                                         |
| Runtime      | Node.js 24 bundled inside Electron — user installs nothing         |
| Electron     | v45                                                                |
| Minimum RAM  | 512MB                                                              |
| Disk space   | ~200MB installed                                                   |
| Network      | Active connection to target SSH servers                            |
| Local DB     | SQLite — single `.db` file in OS user data directory, auto-created |

### 2.4 Assumptions

- The user understands basic SSH concepts (host, port, username, keys)
- The app is for personal or small-team use — not SaaS
- The Express backend runs on an auto-assigned localhost port, chosen at startup
- The SQLite `.db` file lives in `app.getPath('userData')` — no setup or install needed
- Private keys and passwords are never stored unencrypted anywhere on disk

---

## 3. Tech Stack Decision

### 3.1 Final Stack (Actual Versions as Shipped)

| Layer            | Technology                     | Version  | Why                                                                                        |
| ---------------- | ------------------------------ | -------- | ------------------------------------------------------------------------------------------ |
| Desktop Shell    | Electron                       | 39       | Full OS access — native FS, SSH key storage, system tray, native dialogs                   |
| Build Toolchain  | electron-vite                  | 5.0      | Purpose-built for Electron + React. Unified config for main, preload, renderer. HMR in dev |
| Frontend         | React + TypeScript             | 19 / 5.9 | Component model, hooks, full type safety                                                   |
| Styling          | Tailwind CSS                   | v3.4     | Utility-first, no runtime overhead                                                         |
| UI Components    | shadcn/ui                      | Latest   | Accessible Radix primitives styled with Tailwind. Copy-owned — no version lock             |
| Client Routing   | React Router                   | v7       | SPA routing — HashRouter for Electron file:// compat                                       |
| Terminal         | xterm.js                       | 6.0      | Industry-standard in-browser terminal emulator (same as VS Code)                           |
| State Management | Zustand                        | 5        | Minimal boilerplate, no Provider nesting                                                   |
| Data Fetching    | TanStack Query                 | v5       | Async state, caching, retry, loading/error handling                                        |
| HTTP Client      | Axios                          | 1.16     | JWT interceptor, base URL from preload port                                                |
| Backend          | Express.js + TypeScript        | 5        | Simple, fast, full Node.js runtime for native modules                                      |
| SSH              | ssh2                           | Latest   | Most popular Node.js SSH library, actively maintained                                      |
| SFTP             | ssh2-sftp-client               | Latest   | Wraps ssh2 for clean SFTP operations                                                       |
| WebSocket        | ws                             | Latest   | Lightweight WebSocket server for SSH terminal I/O streaming                                |
| Database         | SQLite + Prisma                | Latest   | Zero install, single file DB, full auto-generated TS types                                 |
| SQLite Adapter   | better-sqlite3                 | Latest   | Native WAL-mode SQLite bindings                                                            |
| Password Hashing | bcryptjs                       | Latest   | Master password hashing (cost factor 12) — pure-JS bcrypt, no native build                 |
| Auth Tokens      | jsonwebtoken                   | Latest   | Short-lived JWT between renderer and local Express                                         |
| Encryption       | Node.js `crypto` (built-in)    | —        | AES-256-GCM for all secrets at rest                                                        |
| Key Derivation   | PBKDF2 via `crypto` (built-in) | —        | Derives AES key from master password at unlock                                             |
| Validation       | zod                            | Latest   | Runtime schema validation on all API inputs                                                |
| Key Generation   | node-forge                     | Latest   | RSA/ED25519 keypair generation                                                             |
| PPK Conversion   | sshpk                          | Latest   | PuTTY PPK → OpenSSH conversion                                                             |
| Port Discovery   | portfinder                     | Latest   | Auto-selects a free localhost port for Express on startup                                  |
| Icons            | lucide-react                   | 1.16     | Consistent icon set                                                                        |
| Drag & Drop      | @hello-pangea/dnd              | Latest   | Tab drag-to-reorder (maintained react-beautiful-dnd fork)                                  |
| File Upload UI   | react-dropzone                 | Latest   | Drag-and-drop SFTP upload                                                                  |

### 3.2 electron-vite vs Alternatives

| Concern                   | electron-vite                       | CRA / plain Webpack       |
| ------------------------- | ----------------------------------- | ------------------------- |
| Dev server startup        | ~300ms                              | 5–15s                     |
| Hot Module Replacement    | Native, instant                     | Slow or broken            |
| Main + preload + renderer | Unified one config                  | Multiple separate configs |
| TypeScript                | First-class                         | Requires setup            |
| Output for Electron       | Optimized (ESM)                     | Larger bundles            |
| Community                 | Growing standard for Electron+React | Legacy                    |

### 3.3 Full Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Electron Shell                       │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Renderer Process                      │  │
│  │            (Vite-built React SPA)                  │  │
│  │                                                    │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │  Terminal   │  │   SFTP   │  │  Profiles   │  │  │
│  │  │   Windows   │  │ Windows  │  │  Dashboard  │  │  │
│  │  └─────────────┘  └──────────┘  └─────────────┘  │  │
│  │                                                    │  │
│  │    xterm.js  │  Zustand  │  TanStack Query         │  │
│  └──────────────┬─────────────────────────────────────┘  │
│                 │ contextBridge IPC (window.api)          │
│  ┌──────────────▼──────────────┐                         │
│  │       Preload Script        │                         │
│  │  exposes: backendPort,      │                         │
│  │  pickUploadFile, appVersion │                         │
│  │  readLocalDir, saveTextFile │                         │
│  └──────────────┬──────────────┘                         │
│                 │                                         │
│  ┌──────────────▼──────────────┐                         │
│  │       Main Process          │                         │
│  │  - portfinder → free port   │                         │
│  │  - sets DATABASE_URL        │                         │
│  │  - spawns Express backend   │                         │
│  │  - native file dialogs      │                         │
│  │  - window management        │                         │
│  │  - auto-updater             │                         │
│  │  - logs to app.log          │                         │
│  └──────────────┬──────────────┘                         │
│                 │ 127.0.0.1:{port}                        │
│  ┌──────────────▼──────────────────────────────────────┐ │
│  │              Express.js Backend                     │ │
│  │                                                     │ │
│  │   REST /api/*    WebSocket /ws    Prisma + SQLite   │ │
│  │   SSE (SFTP progress streams)    sshclient.db       │ │
│  │             ssh2 Client Session Pool                │ │
│  └──────────────┬──────────────────────────────────────┘ │
└─────────────────┼───────────────────────────────────────┘
                  │ SSH Protocol (port 22)
        ┌─────────▼──────────┐
        │  Remote SSH Server │
        └────────────────────┘
```

---

## 4. System Architecture

### 4.1 Electron Main Process (`src/main/index.ts`)

- Takes the single-instance lock first; a second launch quits before writing the log or spawning a backend, and the running app brings its main window to the front ✅ (BL-25)
- Uses `portfinder` to find a free localhost port starting from 4000
- Sets `process.env.DATABASE_URL = file:{userData}/sshclient.db`
- Starts the Express.js backend as an Electron utility process (`utilityProcess.fork`, BL-46), with a message channel for lock requests and lock-state reports ✅ (BL-18). The storage key and launch secret are sent in the first message, not in the environment; the packaged app has the `RunAsNode`, `NODE_OPTIONS` and `--inspect` fuses off and ASAR integrity on (ADR-005) ✅ (BL-46)
- Creates `BrowserWindow`, loads Vite renderer
- Passes backend port to preload via IPC channel (`get-backend-port`)
- Handles: window lifecycle, native file dialogs, auto-updater (startup + every 4 hours; notify-only on macOS — BL-24)
- Writes diagnostic logs to `{userData}/app.log`; each start keeps the previous run as `app.log.1` and `app.log.2`, and a log over 5 MB rotates ✅ (BL-43, `src/main/log.ts`)
- Generates a per-launch secret in memory (BL-17) and a per-install storage key (wrapped with Electron `safeStorage` when available; `secrets/` is `0700`, `storage-key` `0600` — BL-19) and sends both to the backend in its first message (BL-46; before that they were environment variables). There is no JWT secret on disk: the backend creates its own in memory (BL-19)
- Runs the app's one idle clock: every window's `input-event` resets it; after `autoLockMinutes` without input (lock on) main asks the backend to lock, then closes the terminal and SFTP windows and sends `app:locked` to the main window ✅ (BL-18, `src/main/idleLock.ts`)
- Hardens every `webContents`: `window.open` denied (http(s) to `shell.openExternal`), navigation outside the renderer blocked, IPC served only to top-level app frames ✅ (BL-21, `src/main/windowSecurity.ts`)
- Gracefully terminates the backend child process on app quit
- Restarts the backend if it exits unexpectedly — same port, backoff 1 s → 2 s → 4 s → 8 s, gives up after 5 crashes within 2 minutes — then sends `backend:restarted` to every window ✅ (BL-16, `src/main/backendSupervisor.ts`)
- IPC handlers exposed:
  - `get-backend-port` — returns the backend port
  - `get-launch-secret` — returns the per-launch secret (BL-17)
  - `get-app-version` — returns `app.getVersion()`, the app version from the packaged `package.json`
  - `sftp:pickUploadFile` — native Open dialog; returns a grant for the chosen file, never its path (BL-47)
  - `sftp:pickDownloadTarget` — native Save dialog for an SFTP download, optionally in a granted local-pane folder; returns a grant (BL-47)
  - `sftp:grantDroppedFile` — grant for a file dropped from the OS; the path comes from the preload, never from the page (BL-47)
  - `dialog:saveTextFile` — main shows the save dialog and writes the given text to the chosen file (BL-22)
  - `dialog:openTextFile` — main shows the open dialog and returns the chosen file's name and text (BL-22)
  - `log:rendererError` — the renderer reports an error `(context, message)`; main validates it, caps it at 2 KB, allows 20 per minute and writes it to app.log (BL-43)
  - `window:openTerminal` — spawns standalone terminal window
  - `window:openSftp` — spawns standalone SFTP window
  - `get-connection-token` — one-time JWT hand-off, to the connection window it was issued for (SEC-07, BL-20)
  - `sftp:readLocalDir` — local-pane listing under the home folder, never inside the app's own data folders, with a read-only grant for the folder (BL-47)
  - `grant-resolve` (backend → main message) — main resolves an SFTP grant to the local path for the backend that asked (BL-47)
  - `updater:install` — triggers update install and app restart (no-op on macOS — BL-24)
  - `updater:openDownloadPage` — opens the GitHub Releases page (BL-24)
  - `backend:restarted` (main → renderer event) — the backend was restarted after a crash; windows re-authenticate (BL-16)
  - `app:locked` (main → renderer event) — the app locked; the main window shows the lock screen (BL-18)

### 4.2 Preload Script (`src/preload/index.ts`)

Runs in an isolated context with Node.js access. Exposes a safe `window.api` surface:

```typescript
type TextFileKind = 'json' | 'cskb' | 'pub' | 'csv' // the dialog's file filter (BL-22, BL-28)

interface ElectronAPI {
  backendPort: number
  launchSecret: string // BL-17
  appVersion: string
  saveTextFile: (req: {
    kind: TextFileKind
    defaultName: string
    content: string
  }) => Promise<string | null> // BL-22
  openTextFile: (req: { kind: TextFileKind }) => Promise<{ name: string; content: string } | null> // BL-22
  openTerminalWindow: (sessionId: string, profileId: string, title: string, token: string) => void
  openSftpWindow: (sessionId: string, profileId: string, title: string, token: string) => void
  getConnectionToken: () => Promise<string | null> // this window's token, once (BL-20)
  // SFTP windows only (BL-47): the page gets opaque grants, never local paths it can send on
  pickUploadFile: () => Promise<{ grant: string; name: string } | null>
  pickDownloadTarget: (req: {
    name: string
    folder?: string
  }) => Promise<{ grant: string; name: string } | null>
  grantDroppedFile: (file: File) => Promise<{ grant: string; name: string } | null>
  readLocalDir: (
    dirPath?: string
  ) => Promise<{ path: string; parent: string | null; grant: string; files: DirEntry[] }>
  onUpdateAvailable: (cb: (info: { version: string; manual: boolean }) => void) => () => void // returns an unsubscribe function
  onUpdateDownloaded: (cb: () => void) => () => void
  onBackendRestarted: (cb: () => void) => () => void // BL-16
  onAppLocked: (cb: () => void) => () => void // BL-18
  installUpdate: () => Promise<void>
  openDownloadPage: () => Promise<void> // BL-24
}
```

No raw Node.js or Electron APIs are exposed to the renderer — no generic `ipcRenderer` passthrough (the `@electron-toolkit/preload` `window.electron` bridge is gone), no call that reads or writes a renderer-supplied path, no local path the page could hand to the backend (SFTP file access goes through grants that main issues — BL-47), and subscriptions pass data only, never the `IpcRendererEvent` (BL-22).

### 4.3 Renderer — React SPA (`src/renderer/`)

- Pure React SPA, built and served by Vite
- Uses `HashRouter` from React Router v7 — required for `file://` protocol
- Reads `window.api.backendPort` to build the base URL for all API calls
- State machine in `App.tsx`: `loading → setup | locked | unlocked → error`
- REST via Axios (with JWT interceptor, and the `X-CypherShell-Launch` header on every request — BL-17) for all CRUD and SFTP operations
- WebSocket via native `WebSocket` API for SSH terminal I/O (base64 framing); the URL carries the JWT and the launch secret (BL-17)
- SSE via native `EventSource` API for real-time SFTP transfer progress streaming
- Zustand manages global in-memory state: open sessions, tab order, transfer queue, terminal theme
- TanStack Query manages all server-state: profiles, keys, logs (caching + retry)
- Auto-lock is timed by the main process (BL-18); on `app:locked` the main window drops its token and shows the lock screen
- Standalone connection windows (`/connection/terminal/:sessionId`, `/connection/sftp/:sessionId`) obtain the JWT through the one-time `get-connection-token` IPC hand-off (SEC-07); a token in the URL is never read (BL-20)
- `UpdateBanner` component listens for auto-update events and shows the install prompt — or, on macOS, a "Download from GitHub Releases" button (BL-24)

### 4.4 Express.js Backend (`backend/src/`)

- Bound to `127.0.0.1:{port}` — not `0.0.0.0`
- Serves only CypherShell's renderer (BL-17, `middleware/caller.middleware.ts`): a `Host` other than the loopback interface or an `Origin` other than `file://` / the dev server gets `403` before any route runs, and `/api/auth/*` and the terminal WebSocket also need the per-launch secret
- Maintains an in-memory session pool: `Map<sessionId, ssh2.Client>`
- `ws` WebSocket server shares the same `http.Server` instance
- SSE endpoints (`text/event-stream`) stream SFTP transfer progress — no polling
- `requireAuthFlexible` middleware accepts JWT from query param (needed for `EventSource` which cannot set headers)
- Prisma handles all SQLite reads/writes; WAL mode enabled on startup
- Rate limiting: 5 unlock attempts/min, 300 API requests/min (configured in `backend/src/index.ts`)
- JWTs are HS256-signed with a secret created in this process's memory (BL-19), issued for 1 hour, and carry a `jti` held in an in-memory `TokenStore`; a token without one is refused. Locking the app (`AppLockService`) revokes every issued token and closes open terminal sockets and SFTP progress streams (BL-18)
- An SSH session closes only when nothing uses it: no consumers (terminal shells, running tunnels, in-flight transfers) and no heartbeat from an open Profile Details tab or SFTP window for 60 s (BL-11)

### 4.5 SSH Terminal Data Flow

```
User types in xterm.js
  → ws.send({ type: 'input', data: 'ls -la\r' })    [base64 encoded]
    → Express WS handler → ssh2 stream.write(data)
      → Remote server processes command
        → ssh2 stream emits 'data' event
          → Express WS handler → ws.send({ type: 'output', data: '...' })
            → xterm.js terminal.write(data) → screen updates
```

### 4.6 SFTP Data Flow

```
User clicks Upload in SFTP pane (main shows the native Open dialog and returns a grant — BL-47)
  → EventSource opens GET /api/sftp/:sessionId/progress/:transferId first
  → Axios POST JSON to /api/sftp/:sessionId/upload
      Body: { transferId, local: { grant }, remotePath }
    → Express controller → asks main to resolve the grant (grant-resolve) → local path
      → SftpService.upload(sessionId, localPath, remotePath, transferId)
      → ssh2 fastPut streams file chunks to `<remotePath>.partial`, then renames it
        → On each chunk: sftp.service emits progress to in-memory EventEmitter
          → SSE handler (GET /api/sftp/:sessionId/progress/:transferId)
              reads EventEmitter → writes "data: {...}\n\n" to response stream
            → Browser EventSource fires "message" event
              → useSFTPTransfer hook updates transferStore
                → React re-renders progress bar
```

---

## 5. Folder Structure

```
CypherShell/
│
├── src/                                  # electron-vite source root
│   │
│   ├── main/                             # Electron Main Process
│   │   ├── index.ts                      # Window creation, backend spawn, IPC, updater
│   │   ├── localGrants.ts                # Grants for SFTP local files (BL-47)
│   │   ├── localFiles.ts                 # Local-pane listing, SFTP dialogs and drops, grant resolution (BL-47)
│   │   ├── backendSupervisor.ts          # Restart-on-crash policy for the backend child (BL-16)
│   │   ├── idleLock.ts                   # One idle clock for every window + backend messages (BL-18)
│   │   ├── secretFiles.ts                # Owner-only secrets/ and storage key (BL-19)
│   │   ├── connectionTokens.ts           # Connection-window route + one-time token hand-off (BL-20)
│   │   ├── windowSecurity.ts             # App-URL, external-link and IPC-sender rules (BL-21)
│   │   ├── textFiles.ts                  # Dialog-bound text export/import (BL-22)
│   │   ├── updatePolicy.ts               # Per-platform updater policy (BL-24)
│   │   └── singleInstance.ts             # Bring the running app to the front (BL-25)
│   │
│   ├── preload/                          # Preload Script
│   │   ├── index.ts                      # contextBridge → window.api
│   │   └── index.d.ts                    # Window.api typings (update together with index.ts)
│   │
│   └── renderer/                         # React Frontend (Vite)
│       ├── index.html                    # Vite HTML entry (CSP)
│       └── src/
│           ├── main.tsx                  # React root — QueryClient
│           ├── App.tsx                   # HashRouter + auth state machine + idle auto-lock
│           │
│           ├── pages/
│           │   ├── Home.tsx              # Profile grid, search, import/export
│           │   ├── Keys.tsx              # SSH key management
│           │   ├── Logs.tsx              # Audit log viewer
│           │   ├── Settings.tsx          # App settings (theme, terminal, lock, retention)
│           │   ├── LockScreen.tsx        # Master password prompt
│           │   └── SetupWizard.tsx       # First-run master password setup
│           │
│           ├── components/
│           │   ├── ImportConflictDialog.tsx      # Skip / Rename / Overwrite per profile (FR-09.7)
│           │   ├── PasswordStrengthHint.tsx      # Master password strength hint (BL-26)
│           │   ├── terminal/
│           │   │   ├── TerminalPane.tsx          # xterm.js wrapper + WS lifecycle
│           │   │   └── TabBar.tsx                # Multi-session tab strip (DnD)
│           │   ├── sftp/
│           │   │   ├── SftpPane.tsx              # Dual-pane SFTP explorer + transfer queue
│           │   │   ├── LocalFilePane.tsx         # Local filesystem pane
│           │   │   ├── PathBreadcrumb.tsx        # Clickable path bar (FR-04.15)
│           │   │   └── InputDialog.tsx           # Rename / new folder / chmod input (BL-14)
│           │   ├── profiles/
│           │   │   ├── ProfileDetailPane.tsx     # Profile detail + connect + tunnels
│           │   │   └── ProfileForm.tsx           # Create / edit modal
│           │   ├── keys/
│           │   │   ├── KeyGeneratorModal.tsx     # RSA / ED25519 generator
│           │   │   ├── KeyImportModal.tsx        # PEM / OpenSSH / PPK import
│           │   │   ├── ExportKeyBundleDialog.tsx # .cskb export (FR-10)
│           │   │   └── ImportKeyBundleDialog.tsx # .cskb import (FR-10)
│           │   ├── layout/
│           │   │   ├── Sidebar.tsx
│           │   │   └── UpdateBanner.tsx           # Auto-update notification bar
│           │   └── ui/                           # shadcn/ui (copy-owned components)
│           │
│           ├── hooks/
│           │   └── useSFTPTransfer.ts            # SSE-based transfer progress hook
│           │
│           ├── store/
│           │   ├── tabStore.ts                   # Active tabs (Zustand)
│           │   ├── transferStore.ts              # SFTP transfer queue (Zustand)
│           │   └── terminalThemeStore.ts         # Terminal theme + font (Zustand, persisted)
│           │
│           └── lib/
│               ├── api.ts                        # Axios instance + JWT interceptor
│               ├── terminalCodec.ts              # UTF-8 ⇄ base64 framing for terminal I/O (BL-15)
│               ├── terminalSocket.ts             # Terminal WebSocket URL + link handler (BL-17, BL-21)
│               ├── passwordStrength.ts           # 10-character rule + strength rating (BL-26)
│               ├── terminalThemes.ts             # The 6 terminal colour schemes
│               └── utils.ts                      # cn() helper + misc utilities
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma                 # Data model (source of truth)
│   │   └── migrations/                   # SQL migrations, applied at startup by db.ts
│   ├── prisma.config.ts                  # Prisma 7 config (schema, migrations, datasource URL)
│   ├── build.cjs                         # esbuild bundle → dist/index.js
│   └── src/
│       ├── index.ts                      # Bootstrap: initDatabase → createApp → listen → jobs
│       ├── app.ts                        # createApp() + startBackgroundJobs() (shared with tests)
│       ├── routes/
│       │   ├── auth.routes.ts            # /api/auth/*
│       │   ├── profile.routes.ts         # /api/profiles/*
│       │   ├── session.routes.ts         # /api/sessions/*
│       │   ├── sftp.routes.ts            # /api/sftp/*
│       │   ├── key.routes.ts             # /api/keys/*
│       │   ├── tunnel.routes.ts          # /api/tunnels/:sessionId/start|stop
│       │   ├── audit.routes.ts           # /api/audit/*
│       │   ├── config.routes.ts          # /api/config
│       │   └── known-host.routes.ts      # /api/known-hosts
│       ├── controllers/
│       │   ├── auth.controller.ts
│       │   ├── profile.controller.ts
│       │   ├── session.controller.ts
│       │   ├── sftp.controller.ts
│       │   ├── key.controller.ts
│       │   ├── tunnel.controller.ts
│       │   ├── audit.controller.ts
│       │   └── config.controller.ts
│       ├── services/
│       │   ├── ssh.service.ts            # SSH session pool, consumers, reaper
│       │   ├── sftp.service.ts           # SFTP file operations + progress emitter
│       │   ├── key.service.ts            # Key generation, import, fingerprint, .cskb bundles
│       │   ├── profile.service.ts        # Profile export payload + import with conflicts
│       │   ├── tunnel.service.ts         # Port forwarding tunnel lifecycle
│       │   ├── crypto.service.ts         # AES-256-GCM + PBKDF2
│       │   ├── secrets.service.ts        # Re-encrypt all secrets on a key change (BL-10)
│       │   ├── app-lock.service.ts       # Lock: forget key, revoke tokens, close transports (BL-18)
│       │   ├── host-bridge.service.ts    # IPC channel to the main process (BL-18)
│       │   ├── local-path.service.ts     # SFTP local-path checks (BL-23)
│       │   ├── local-grant.service.ts    # Asks main to resolve SFTP grants (BL-47)
│       │   ├── audit.service.ts          # Event logging + CSV export
│       │   ├── config.service.ts         # App config read/update (singleton row)
│       │   ├── token-store.service.ts    # Issued JWT ids (revocation on lock)
│       │   └── logger.service.ts         # Timestamped stdout/stderr logger
│       ├── websocket/
│       │   └── terminal.ws.ts            # WS handler — xterm.js ↔ ssh2 bridge
│       ├── middleware/
│       │   ├── auth.middleware.ts        # JWT verification (header + query param), jti required (BL-19)
│       │   └── caller.middleware.ts      # Host / Origin / launch-secret checks (BL-17)
│       └── config/
│           ├── db.ts                     # initDatabase() — migrate + WAL + connect
│           └── env.ts                    # In-memory JWT signing secret (BL-19)
│
├── tests/
│   ├── backend/                          # Vitest + Supertest against the real app factory
│   ├── renderer/                         # Vitest + Testing Library (jsdom)
│   └── e2e/                              # Playwright for Electron
│
├── resources/                            # Runtime icon (icon.png)
├── build/                                # electron-builder resources (icon.ico, icon.icns, installer.nsh)
├── specs/                                # Spec index, ADRs, templates
├── docs/                                 # Documentation assets
├── scripts/                              # Build helpers (after-pack, native-prebuild)
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

---

## 6. Functional Requirements

### FR-01: Saved Connection Profiles

**Priority:** High | **Status:** ✅ Implemented

- FR-01.1 — Profile fields: Name, Host, Port (default 22), Username, Auth method (Password / SSH Key / Key + Passphrase) ✅ (BL-13)
- FR-01.2 — Home page shows profile cards: name, host, group tag, last connected time ✅ (BL-31 — a successful connection records `lastConnectedAt`; cards show "Last connected <time ago>" or "Never connected")
- FR-01.3 — "Manage Profile" opens a Profile Detail tab; Terminal and SFTP windows spawn from there
- FR-01.4 — Stored in SQLite via Prisma; passwords/passphrases AES-256-GCM encrypted before write
- FR-01.5 — Profiles can be duplicated with one click ✅
- FR-01.6 — Profiles can be tagged/grouped (e.g. "Production", "Staging") ✅
- FR-01.7 — Real-time search and filter by name or host ✅
- FR-01.8 — Edit an existing profile's fields via an "Edit Profile" action accessible from the Profile Detail tab and from the profile card context menu on the Home page ✅

### FR-01.8: Profile Edit

**Priority:** High | **Status:** ✅ Implemented

#### Requirements

- FR-01.8.1 — An "Edit Profile" button is present in the Profile Detail tab header area ✅
- FR-01.8.2 — A per-profile "Edit" option is available in the profile card context/action menu on the Home page (alongside Duplicate, Delete, Export) ✅
- FR-01.8.3 — Activating either entry opens the existing `ProfileForm` dialog pre-populated with the current profile's values ✅
- FR-01.8.4 — On save, the form issues `PUT /api/profiles/:id` with only the changed fields ✅ (BL-13) — the password or passphrase is sent only when typed, and switching to plain SSH-key auth sends `password: ''` to clear it (FR-01.8.6)
- FR-01.8.5 — On successful save, TanStack Query caches for `['profiles']` and `['profile', profileId]` are invalidated so all views reflect the update immediately ✅
- FR-01.8.6 — If the profile's `authMethod` changes (e.g. from Password to SSH Key), the form clears the irrelevant credential fields before submitting ✅
- FR-01.8.7 — Form validation mirrors the create flow: Name, Host, Port, and Username are required; Port must be 1–65535 ✅ (BL-31 — the form shows an error under each invalid field and sends nothing until it is valid; a key method also needs a key, and a new password or passphrase where one is required)

- FR-01.9 — Password profiles also log in to servers that offer only keyboard-interactive authentication: a single hidden prompt is answered with the stored password; any other challenge (one-time codes, several prompts) fails with a clear message ✅ (BL-40 — `tryKeyboard` in `ssh.service.ts`)

#### Acceptance Criteria

- [ ] Clicking "Edit" from the Profile Detail tab opens `ProfileForm` with all current field values pre-filled
- [ ] Clicking "Edit" from a Home page profile card context menu opens the same form pre-filled
- [ ] Saving changes calls `PUT /api/profiles/:id`; the Profile Detail tab and Home card both show updated values without a page reload
- [ ] Changing auth method from Password → SSH Key clears the stored password field in the submitted payload
- [ ] Submitting with a blank Name, Host, or Username shows inline validation errors and does not call the API
- [ ] Submitting with Port outside 1–65535 shows a validation error
- [ ] Cancelling the dialog leaves the profile unchanged

#### Implementation Notes

| Layer              | File(s)                                                      | Change needed                                                                                                |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Frontend form      | `src/renderer/src/components/profiles/ProfileForm.tsx`       | Pass `profile` prop for edit mode; wire `PUT /api/profiles/:id` mutation alongside existing create path      |
| Profile Detail tab | `src/renderer/src/components/profiles/ProfileDetailPane.tsx` | Add "Edit Profile" button (pencil icon); manage `editOpen` state; render `<ProfileForm profile={profile} …>` |
| Home page card     | `src/renderer/src/pages/Home.tsx`                            | Add "Edit" item to profile card dropdown/context menu; pass selected profile to `ProfileForm`                |
| API client         | `src/renderer/src/lib/api.ts`                                | Add `updateProfile(id, data)` helper (wraps `api.put`) if one does not already exist                         |
| Backend route      | `backend/src/routes/profile.routes.ts`                       | `PUT /api/profiles/:id` already exists — no change required                                                  |
| Backend controller | `backend/src/controllers/profile.controller.ts`              | Verify partial-update (PATCH-style) is handled correctly; encrypted fields must re-encrypt on change         |

#### Out of Scope

- Editing a profile that is currently connected — the edit form may be opened but the running session is unaffected until next connect
- Bulk-editing multiple profiles at once
- Renaming a profile group/tag directly from the edit form (tag editing follows existing FR-01.6 flow)

---

### FR-02: SSH Terminal

**Priority:** High | **Status:** ✅ Implemented

- FR-02.1 — Connecting opens a Profile Details tab; users spawn standalone terminal console windows from it ✅
- FR-02.2 — xterm.js renders with full ANSI colour and escape sequence support, including UTF-8 text ✅ (BL-15 — output is written as bytes and input is encoded as UTF-8)
- FR-02.3 — PTY resizes dynamically when the standalone window resizes (`@xterm/addon-fit`) ✅ (BL-29 — a resize sent before the remote shell is ready is applied once it starts)
- FR-02.4 — Copy (Ctrl+Shift+C) supported; right-click pastes the clipboard ✅ (BL-08)
- FR-02.5 — Full keyboard support: Ctrl+C, Ctrl+Z, Tab, arrow keys, function keys ✅
- FR-02.6 — Auto-reconnect on drop: exponential backoff (1s → 2s → 4s), max 3 retries ✅ — a socket drop reconnects with that backoff to a new shell on the same SSH session; `exit` (close 1000), a vanished session (1008), a lock (4001) and a lost SSH connection (4002) are not retried (BL-29). From BL-41 the backend also re-establishes a dropped SSH connection itself when the profile has `autoReconnect` on: the session keeps its id, terminals keep their WebSocket and get a new shell, local and dynamic tunnels work again and remote forwards are re-registered
- FR-02.7 — Connection status badge: connected / reconnecting / disconnected ✅ (BL-29)
- FR-02.8 — Closing standalone terminal window closes its shell; the SSH session stays open while other terminals, tunnels, transfers or an open Profile Details tab use it ✅ (BL-11)
- FR-02.9 — The JWT reaches popup windows through a one-time IPC hand-off, to that window only — no re-auth required, and no token in any window URL ✅ (BL-20)
- FR-02.10 — Terminal font, font size, and color theme customizable ✅ (BL-35 — changes also update terminals that are already open, in every window)
- FR-02.11 — Selecting text in the terminal automatically copies it to the system clipboard ✅

---

### FR-03: Multi-Tab Dashboard & Window Sessions

**Priority:** High | **Status:** ✅ Implemented

- FR-03.1 — Persistent "Home" anchor tab + dynamic Profile Detail tabs ✅
- FR-03.2 — Opening a saved profile spawns a dedicated Profile Details tab ✅
- FR-03.3 — Tabs can be switched; drag-to-reorder via `@hello-pangea/dnd` ✅
- FR-03.4 — Multiple concurrent Terminal and SFTP windows per profile tab ✅
- FR-03.5 — Active tabs keep SSH session pools alive in the Express backend ✅ (BL-11 — an open Profile Details tab or SFTP window renews a heartbeat lease; sessions with consumers are never reaped)

---

### FR-04: SFTP File Manager

**Priority:** High | **Status:** ⚠️ Partially Implemented (FR-04.15 local pane tracked)

- FR-04.1 — SFTP Explorer opens in standalone window from Profile Details tab ✅
- FR-04.2 — Left pane: local machine files; Right pane: remote server files ✅
- FR-04.3 — Navigate by double-clicking folders ✅
- FR-04.4 — Upload: Upload button (native file dialog) + drag-and-drop ✅ (BL-30 — files dropped from the OS use `webUtils.getPathForFile`; uploading over an existing file replaces it). From BL-47 every source is a grant from main, and a `text/plain` drop is ignored
- FR-04.5 — Download: Download button (native save dialog) ✅. From BL-47 a remote file dropped on the local pane also opens the Save dialog, in that folder with a cleaned name
- FR-04.6 — Rename in-place via the row action and F2 ✅ (BL-14 — in-app dialog)
- FR-04.7 — Delete with confirmation ✅ (BL-30 — files, and empty folders through `rmdir`; a non-empty folder fails with the server's message, recursive delete is out of scope)
- FR-04.8 — Create new folder via button and Ctrl+Shift+N ✅ (BL-14 — in-app dialog)
- FR-04.9 — Show and edit Unix permissions (chmod) ✅ (BL-14 — in-app dialog with octal validation)
- FR-04.10 — Per-transfer progress via SSE: filename, bytes, %, speed + elapsed computed from progress deltas ✅
- FR-04.11 — Multiple simultaneous transfers in a queue; each has its own SSE stream and its own SFTP channel ✅ (BL-14)
- FR-04.12 — Transfer history: completed, active, and failed ✅
- FR-04.13 — Failed transfers: one-click retry with error reason shown ✅ (BL-30 — a failed transfer shows its error and a Retry button; a request the backend refuses also fails visibly). From BL-47 Retry reuses the grant; a grant that is no longer valid asks the user to pick the file again
- FR-04.14 — Toggle hidden files (dotfiles) ✅
- FR-04.15 — Breadcrumb path bar in both panes with click-to-navigate ⚠️ — the remote pane now starts at the absolute home path and reaches `/` (BL-30); the local pane is still limited to the home directory (tracked, not scheduled). From BL-47 it goes Up to home, and it refuses the app's own data folders
- FR-04.16 — Cancel an in-progress transfer — only that transfer's channel is closed ✅ (BL-01, BL-14)

---

### FR-05: SSH Key Management

**Priority:** High | **Status:** ✅ Implemented

- FR-05.1 — Generate RSA (2048 / 4096-bit) and ED25519 keypairs in OpenSSH format ✅ (BL-12)
- FR-05.2 — Import PEM format private keys via file picker ✅
- FR-05.3 — Import OpenSSH format private keys ✅
- FR-05.4 — Import PuTTY PPK keys — converted to OpenSSH via sshpk when ssh2 cannot read them ✅ (BL-12)
- FR-05.5 — All private keys AES-256-GCM encrypted in SQLite ✅
- FR-05.6 — Optional passphrase protection per stored key ✅ (BL-12 — a generation passphrase encrypts the OpenSSH key; profiles use it with "SSH Key + Passphrase")
- FR-05.7 — SHA-256 fingerprint and key type displayed per key ✅
- FR-05.8 — Copy public key to clipboard with one click ✅
- FR-05.9 — Export public key to file via native save dialog ✅
- FR-05.10 — Assign stored keys to profiles via the profile form ✅
- FR-05.11 — Delete key with confirmation; the confirmation lists profiles that use the key ✅ (BL-03)
- FR-05.12 — Name and optional description per key ✅

---

### FR-06: Port Forwarding (Tunnels)

**Priority:** High | **Status:** ✅ Implemented

- FR-06.1 — Local forwarding: `localhost:localPort → remoteHost:remotePort` ✅ (BL-16 — a client reset no longer crashes the backend)
- FR-06.2 — Remote forwarding: `remoteHost:remotePort → localhost:localPort` ✅
- FR-06.3 — Dynamic SOCKS5 proxy ✅
- FR-06.4 — Tunnel panel displayed inline inside Profile Details tab ✅ (BL-34 — rules can be saved to the profile, listed, started and deleted)
- FR-06.5 — Start/stop individual tunnels without interrupting terminal/SFTP windows ✅
- FR-06.6 — Port conflict detection before binding ✅ (BL-02, BL-31 — a busy local port answers `409 { code: 'PORT_IN_USE', port }` and the UI names the port)

---

### FR-07: Application Lock

**Priority:** Medium | **Status:** ✅ Implemented

- FR-07.1 — First-run setup wizard: set master password or skip ✅ (BL-10 — startup jobs no longer create the config row)
- FR-07.2 — Lock screen shown on app open if lock is enabled ✅
- FR-07.3 — Master password hashed with bcrypt (cost 12) ✅
- FR-07.4 — PBKDF2-SHA512 derives AES key from master password at unlock — memory only ✅
- FR-07.5 — Auto-lock after configurable idle timeout (default 15 minutes) ✅ (BL-18 — one idle clock in the main process counts input in every window; a lock closes the terminal and SFTP windows and their sockets)
- FR-07.6 — Lost master password = all encrypted data permanently unrecoverable — shown prominently ✅
- FR-07.7 — Changing the lock mode never loses data: setting a master password on a skip-lock install, or turning lock off, re-encrypts every stored secret under the new key in a single transaction, and turning lock off requires the current master password ✅ (BL-10 — `SecretsService.rekey`, `POST /api/auth/setup-password`, `POST /api/auth/disable-lock`)
- FR-07.8 — Change master password (current + new password; all secrets re-encrypted in one transaction) ✅ (BL-39 — `POST /api/auth/change-password`, Settings → Security)

---

### FR-08: Audit Logs

**Priority:** Medium | **Status:** ✅ Implemented

- FR-08.1 — Log: SSH connect (profile, host, timestamp, success/fail, error message) ✅
- FR-08.2 — Log: SSH disconnect with duration and reason ✅ (BL-05, BL-32 — exactly one disconnect entry per session, with its duration and reason: closed by user, idle timeout, connection error (with the message) or closed by remote)
- FR-08.3 — Log: SFTP upload (filename, size, remote path, timestamp, success/fail) ✅
- FR-08.4 — Log: SFTP download (filename, size, local path, timestamp) ✅
- FR-08.5 — Paginated log table with search and date range filter ✅ (BL-32 — the API filters by type, date range and search text and returns one page with the total; the Logs page has a pager and a "Disconnection" type)
- FR-08.6 — Export logs as CSV via native save dialog — fetched through the API client with the session token, saved with `dialog:saveTextFile`; every text field is quoted, and a value a spreadsheet would run as a formula gets a leading single quote ✅ (BL-28, BL-32)
- FR-08.7 — Auto-purge logs older than N days — at startup and every 24 hours ✅ (BL-04, BL-10)
- FR-08.8 — Clear all logs via UI with confirmation (`DELETE /api/audit`) ✅ (BL-06)

---

### FR-09: Profile Export/Import

**Priority:** Medium | **Status:** ✅ Implemented (FR-09.2 field list corrected — see note)

Export and import connection profiles as JSON files for backup, sharing, and migration. SSH key material is intentionally excluded from profile exports — keys are managed separately via FR-10.

- FR-09.1 — Export selected profiles or all profiles as a `.json` file via native save dialog ✅
- FR-09.2 — Exported JSON includes all profile metadata: `name`, `host`, `port`, `username`, `authMethod`, `group`, `terminalTheme`, `fontSize`, `autoReconnect`, and port-forwarding rules ✅ (corrected in v3.3: Profile has no `description` column; saved tunnel rules are exported — FR-06.4, BL-34)
- FR-09.3 — Exported JSON explicitly excludes all SSH key material (no private key, passphrase, or encrypted blob); if a profile has a linked key, only the key's display name is noted in a `linkedKeyName` field as a user hint ✅
- FR-09.4 — Import profiles from a CypherShell profile export `.json` file via native file picker ✅
- FR-09.5 — On import, if `linkedKeyName` is present, the backend resolves it against existing SSH keys by name and links the profile automatically. ✅
- FR-09.6 — A single export file may contain multiple profiles; all are imported in one operation ✅
- FR-09.7 — On import conflict (profile name already exists), the user is shown a per-profile choice: **Skip**, **Rename** (append suffix), or **Overwrite** ✅
- FR-09.8 — Export action is accessible from the Profiles list page — both a global "Export All" and a per-profile context menu "Export" ✅
- FR-09.9 — Import action is accessible from the Profiles list page ✅

**Acceptance Criteria:**

- [ ] Exporting a profile that uses key-based auth produces a JSON file with no private key or passphrase field — only `linkedKeyName` with the key's display name
- [ ] Exporting a profile that uses password auth produces a JSON file with no password field (passwords are never exported)
- [ ] Importing a valid export file creates all profiles in the database; profiles with `linkedKeyName` are automatically linked to matching SSH keys by name
- [ ] Importing with a conflict (duplicate name) shows the Skip / Rename / Overwrite dialog — not a silent overwrite
- [ ] Import and export round-trip: export a profile, delete it, re-import — profile appears with correct metadata and `sshKeyId = null`

**Implementation Notes:**

| Layer              | File(s)                                                | Change needed                                                          |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Backend route      | `backend/src/routes/profile.routes.ts`                 | `GET /api/profiles/export`, `POST /api/profiles/import`                |
| Backend controller | `backend/src/controllers/profile.controller.ts`        | `exportProfiles`, `importProfiles` handlers                            |
| Backend service    | `backend/src/services/profile.service.ts`              | `buildExportPayload`, `applyImport` — strip sensitive fields on export |
| IPC                | `src/preload/index.ts` + `src/preload/index.d.ts`      | Expose `showSaveDialog` and `showOpenDialog` for `.json` files         |
| Frontend component | `src/renderer/src/pages/Home.tsx`                      | Export All / Import buttons                                            |
| Frontend component | `src/renderer/src/components/ImportConflictDialog.tsx` | New — Skip / Rename / Overwrite per-profile UI                         |
| API client         | `src/renderer/src/lib/api.ts`                          | `exportProfiles(ids?)`, `importProfiles(data)`                         |

**Out of Scope:**

- Exporting passwords or passphrases in any form — profiles with password auth export metadata only
- Exporting linked SSH key material — that is FR-10
- Importing raw PEM/OpenSSH key files — that is FR-05.2–FR-05.4

---

### FR-10: SSH Key Export/Import

**Priority:** Medium | **Status:** ✅ Implemented

Export SSH keys as encrypted `.cskb` (CypherShell Key Bundle) files for backup and migration. The bundle re-encrypts the private key with a user-supplied passphrase so it is never written to disk unprotected. Import restores from a `.cskb` file and re-encrypts with the current app master key.

- FR-10.1 — Export a key as an encrypted `.cskb` file via native save dialog; only one key per export file ✅
- FR-10.2 — The `.cskb` bundle is a JSON envelope containing: `version`, `keyName`, `keyType`, `description`, `publicKey` (plaintext), `encryptedPrivateKey` (AES-256-GCM), `iv`, `salt`, `authTag` — where the encryption key is derived from the user-supplied export passphrase via PBKDF2-SHA512 (200 000 iterations) ✅
- FR-10.3 — User must supply and confirm an export passphrase before export proceeds — the file is never written without passphrase encryption ✅
- FR-10.4 — Import a `.cskb` file via native file picker ✅
- FR-10.5 — On import, user is prompted for the export passphrase; the private key is unwrapped, then immediately re-encrypted with the current app master key and stored in the database — the export passphrase is not retained ✅ (keys with their own passphrase round-trip since BL-12)
- FR-10.6 — On import conflict (key name already exists), the user is shown: **Skip**, **Rename** (append suffix), or **Overwrite** ✅ (BL-33 — Overwrite replaces the key in place: its id and its profiles' links stay, and a bundle that fails to import leaves the old key untouched)
- FR-10.7 — Export and Import are accessible from the SSH Keys management page via the per-key action/context menu ✅
- FR-10.8 — The `.cskb` format is explicitly distinct from the raw PEM/public-key export in FR-05.9 — `.cskb` is a CypherShell-native full-key backup; FR-05.9 exports only the public key ✅

**Acceptance Criteria:**

- [ ] Exporting a key without entering a passphrase is blocked — the export dialog requires passphrase + confirmation before saving
- [ ] The exported `.cskb` file contains no plaintext private key field; only the AES-256-GCM ciphertext, IV, salt, and authTag
- [ ] Importing a valid `.cskb` with the correct passphrase creates the key in the database with the private key encrypted under the app master key
- [ ] Importing a `.cskb` with the wrong passphrase shows a clear error and does not create any database record
- [ ] Import-export round-trip: export a key, delete it, re-import — key appears with correct fingerprint and type
- [ ] Importing into an app with a different master password still succeeds (the export passphrase is independent of the master key)

**Implementation Notes:**

| Layer              | File(s)                                                      | Change needed                                                                                             |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Backend route      | `backend/src/routes/key.routes.ts`                           | `GET /api/keys/:id/export`, `POST /api/keys/import`                                                       |
| Backend controller | `backend/src/controllers/key.controller.ts`                  | `exportKey`, `importKey` handlers                                                                         |
| Backend service    | `backend/src/services/key.service.ts`                        | `buildKeyBundle` (re-encrypt with passphrase), `applyKeyImport` (unwrap + re-encrypt with master key)     |
| Crypto service     | `backend/src/services/crypto.service.ts`                     | Add `derivePassphraseKey(passphrase, salt)` and `encryptWithPassphrase` / `decryptWithPassphrase` helpers |
| IPC                | `src/preload/index.ts` + `src/preload/index.d.ts`            | Expose `showSaveDialog` and `showOpenDialog` for `.cskb` files (reuse if already added for FR-09)         |
| Frontend component | `src/renderer/src/components/keys/ExportKeyBundleDialog.tsx` | New — passphrase + confirm input before export                                                            |
| Frontend component | `src/renderer/src/components/keys/ImportKeyBundleDialog.tsx` | New — file picker + passphrase input for import                                                           |
| API client         | `src/renderer/src/lib/api.ts`                                | `exportKey(id, passphrase)`, `importKey(bundle, passphrase)`                                              |

**Out of Scope:**

- Exporting raw private key as PEM/OpenSSH without passphrase protection — this FR always wraps with a passphrase
- Batch export of multiple keys in a single file — one key per `.cskb` file
- Importing raw PEM/OpenSSH/PPK files — that is FR-05.2–FR-05.4

---

### FR-11: SSH Host-Key Verification

**Priority:** High | **Status:** ❌ Not Implemented (BL-38)

CypherShell currently accepts whatever host key a server presents (no `hostVerifier` in the ssh2 connect config), so anyone on the network path can impersonate a server and capture passwords. This requirement adds trust-on-first-use (TOFU) verification, the model OpenSSH uses with `known_hosts`.

- FR-11.1 — On the first connection to a `host:port`, the server's key type and SHA-256 fingerprint are shown, and the user must accept them before any authentication is attempted ✅ (BL-38)
- FR-11.2 — Accepted host keys are stored per `host:port` in a new `KnownHost` table (key type, SHA-256 fingerprint, first-seen and last-seen timestamps) ✅ (BL-38)
- FR-11.3 — If a later connection presents a different key for the same `host:port`, the connection is aborted before any credential is sent, and a prominent warning shows the stored and presented fingerprints ✅ (BL-38)
- FR-11.4 — Known hosts can be listed and removed in Settings, so a legitimately re-keyed server can be trusted again ✅ (BL-38)
- FR-11.5 — Host-key decisions the backend can observe (confirmation requested, trusted, changed key blocked, known host removed) are written to the audit log ✅ (BL-38; a user declining the dialog is not visible to the backend)

**Acceptance Criteria:**

- [ ] The first connect to a new server shows its fingerprint; declining aborts the connection and no authentication attempt reaches the server
- [ ] Reconnecting to a trusted server proceeds without a prompt
- [ ] A changed host key blocks the connection, shows both fingerprints, and sends no password or key signature
- [ ] Removing a known host in Settings makes the next connect prompt again
- [ ] An integration test against an in-process `ssh2.Server` covers accept, reconnect and mismatch

**Implementation Notes:**

| Layer              | File(s)                                                            | Change needed                                                                                                              |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| DB schema          | `backend/prisma/schema.prisma`                                     | New `KnownHost` model (`host`, `port`, `keyType`, `fingerprint`, `firstSeenAt`, `lastSeenAt`) + migration                  |
| Backend service    | `backend/src/services/ssh.service.ts`, new `known-host.service.ts` | `hostVerifier` in `ConnectConfig`; unknown key → abort with the fingerprint; mismatch → abort                              |
| Backend route      | `backend/src/routes/profile.routes.ts`, new `known-host.routes.ts` | Connect returns `409 { code: 'HOST_KEY_UNKNOWN' \| 'HOST_KEY_MISMATCH', fingerprint }`; `GET/POST/DELETE /api/known-hosts` |
| Frontend component | `ProfileDetailPane.tsx`, `Settings.tsx`                            | Fingerprint confirmation dialog, then retry the connect; known-hosts list with remove                                      |

**Out of Scope:**

- Importing an existing `~/.ssh/known_hosts` file
- SSHFP DNS records and OpenSSH host certificates

---

## 7. Non-Functional Requirements

### NFR-01: Performance

| Metric                                  | Target                   | Measured by (BL-45)                                                                                                | Status                                                                                                                                                |
| --------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| App cold start (Electron window open)   | < 4 seconds              | `tests/e2e/perf.spec.ts`: launch → window shown on ready-to-show (soft gate: fails above 8 s)                      | ⚠️ 5.4 s on the Windows development machine — above the target, below the gate (the window is created at about 0.2 s but first paint takes about 4 s) |
| Vite renderer ready after window opens  | < 1 second               | `tests/e2e/perf.spec.ts`: window → setup wizard visible (soft gate)                                                | ✅ 0.23 s                                                                                                                                             |
| SSH terminal input-to-display latency   | < 50ms                   | `tests/perf/api.perf.ts`: p95 of 200 WebSocket echoes (backend path only: it excludes the renderer's drawing time) | ✅ 0.3 ms                                                                                                                                             |
| Profile list load (100 profiles)        | < 200ms                  | `tests/perf/api.perf.ts`: `GET /api/profiles`, median of 20                                                        | ✅ 2.5 ms                                                                                                                                             |
| SFTP directory listing (1000 files)     | < 2 seconds              | `tests/perf/api.perf.ts`: first listing, including opening the channel                                             | ✅ 11 ms                                                                                                                                              |
| Maximum concurrent SSH sessions         | 20 without memory issues | `tests/perf/api.perf.ts`: 20 sessions, each shell must echo; memory growth reported                                | ✅ 20 of 20 echo, +2.8 MB                                                                                                                             |
| SQLite query time (all typical queries) | < 50ms                   | `tests/perf/api.perf.ts`: audit page over 10 000 rows, profile list, key list                                      | ✅ ≤ 1.6 ms                                                                                                                                           |

Run `npm run test:perf` for the backend metrics and `npm run test:e2e` for the two startup timings. Each value is written to `perf-results/<metric>.json`; CI lists them in the job summary. Hard gates fail the run at the target; the two startup timings are soft gates (a warning above the target, a failure above twice the target). The values above were measured on 2026-11-22 on the Windows development machine; the CI numbers will differ.

### NFR-02: Security

- All passwords, passphrases, private keys AES-256-GCM encrypted before DB write
- AES key derived at runtime from master password via PBKDF2-SHA512 — never persisted
- Private key material never sent across IPC bridge to renderer
- Express bound to `127.0.0.1` only — never `0.0.0.0`
- JWT expires after 1 hour (`expiresIn: '1h'`), re-issued on unlock; the renderer re-authenticates when a request outside `/api/auth` returns 401 ✅ (BL-16)
- All API inputs validated with zod before reaching controllers ✅ (BL-23 — SFTP, tunnel and config joined the profile, auth and key routes)
- The backend accepts no local path from the renderer: SFTP transfers name a grant that the main process issued for a file the user picked in a native dialog or dropped from the OS, or for a local-pane folder (under home, never in the app's own data folders); main resolves it for the backend and checks it again ✅ (BL-47, ADR-006). The resolved path is still checked: absolute, normalized, an existing regular file to upload, an existing directory to download into ✅ (BL-23). (This replaces "no `..` traversal in SFTP paths": for a user with shell access, remote `..` is not a security boundary, so remote paths are only checked for well-formedness.)
- Context isolation enabled in Electron — renderer has no direct Node.js access
- SSH host keys are verified before authentication (FR-11) ✅ (BL-38)
- The local API accepts requests only from CypherShell's own renderer: a per-launch secret on `/api/auth/*` and the WebSocket upgrade, a strict Origin allowlist (no `null`, no arbitrary localhost origins in production) and a `Host` header check against DNS rebinding ✅ (BL-17)
- Token revocation is enforced on every transport (REST, SSE, WebSocket), and locking closes open terminal and SFTP sessions ✅ (BL-18)
- JWTs are signed with a secret that exists only in the backend's memory, accept only `HS256`, and always carry a revocable `jti`; secret files are readable by the owner only (`0600` in a `0700` directory) ✅ (BL-19)
- No credential appears in a window URL ✅ (BL-20)
- Every window denies `window.open` and navigation outside the app, and IPC handlers serve only top-level app frames ✅ (BL-21)
- The renderer cannot read or write files by path: text import and export go through native dialogs that the main process runs ✅ (BL-22), and SFTP transfers go through grants ✅ (BL-47)
- A new master password has at least 10 characters ✅ (BL-26)

### NFR-03: Reliability

- SSH session errors are isolated per tab — one failure does not affect others ✅ (BL-16 — every forwarded socket has an error handler)
- Auto-reconnect: exponential backoff (1s → 2s → 4s), max 3 retries ✅ (see FR-02.6, BL-41)
- Electron main auto-restarts Express if it crashes unexpectedly ✅ (BL-16)
- SQLite WAL mode — prevents corruption on force-quit
- Only one instance of the app runs at a time; a second launch brings the running app to the front ✅ (BL-25)

### NFR-04: Usability

- Familiar to anyone who has used PuTTY, MobaXterm, or Bitvise
- All destructive actions require explicit confirmation
- Every async operation has a loading state
- All errors shown in plain language with a retry option
- Keyboard navigable throughout

### NFR-05: Cross-Platform

- Identical behaviour on Windows, macOS, and Linux
- macOS 13 or later (required by Electron 44 and later — BL-36)
- Linux with glibc 2.34 or later (Ubuntu 22.04+), required by the `better-sqlite3` prebuild — BL-36
- Native file dialogs via Electron IPC for all file/directory selection
- `path.posix` for remote paths, `path` (OS-aware) for local paths
- Keyboard shortcuts adapted per OS via Electron accelerators ⚠️ — no application accelerators are defined; shortcuts are handled in the renderer (tracked, not scheduled)

### NFR-06: Maintainability

- 100% TypeScript — renderer, backend, main, preload; all three are type-checked by `npm run typecheck`
- ESLint + Prettier enforced
- Business logic only in services — controllers are thin ✅ (BL-42 — no controller imports the database or calls Prisma; `tests/backend/layering.test.ts` enforces it)
- Prisma schema is the single source of truth for data shapes
- E2E tests run the built app on a throwaway profile (`--user-data-dir` in a temp directory, deleted afterwards), never on the user's real `userData` (BL-27)

### NFR-07: Release & Distribution

Installers are produced for all three target platforms:

| Platform | Targets          | Architectures              |
| -------- | ---------------- | -------------------------- |
| Windows  | NSIS `.exe`      | x64                        |
| Linux    | AppImage, `.deb` | x64                        |
| macOS    | `.dmg`, `.zip`   | x64, arm64 (Apple Silicon) |

- Every platform is built in CI on its **native runner** — Windows on `windows-2022` (pinned: the `windows-latest` image ships a Visual Studio that node-gyp cannot detect), Linux on `ubuntu-latest`, macOS on `macos-latest`. No cross-compilation of the Electron shell.
- A single reusable matrix workflow builds all three platforms, so adding or changing a platform is a one-line matrix edit rather than a new hand-written job.
- Merging to `main` publishes a GitHub Release carrying every platform's installers.
- Pull requests targeting `main` build the same three platforms as downloadable workflow artifacts, so packaging regressions are caught before merge. PR builds never publish a Release.
- Native modules (`better-sqlite3`) are rebuilt for the **target architecture and Electron ABI** during packaging, and the resulting binary is verified to match the target architecture before the installer is created. From BL-36 (ADR-003): `better-sqlite3` 13 ships N-API prebuilt binaries, so nothing is rebuilt — packaging keeps only the target platform's prebuild and verifies its architecture from the binary header.
- Auto-update metadata (`latest.yml`, `latest-linux.yml`, `latest-mac.yml`) and blockmaps are published alongside the installers, so the in-app `electron-updater` feed resolves.
- Installer filenames identify their platform and architecture (`CypherShell-<version>-<platform>-<arch>[-setup].<ext>`, platform ∈ `windows` | `macos` | `linux`), so a Release's flat asset list is unambiguous. The `latest*.yml` and `.blockmap` filenames are exempt — `electron-updater` resolves those by exact name, so they must not be renamed.
- The macOS `.zip` target is required — `electron-updater` cannot install from a `.dmg`.
- While macOS builds are unsigned, the in-app updater on macOS only announces a new version and links to the GitHub Releases page: Squirrel.Mac refuses to install an unsigned update ✅ (BL-24 — unit-tested; not verified on a Mac).
- A Release tag is derived from `version` in the root `package.json`; re-running the pipeline without a version bump must warn rather than silently overwrite an existing Release.
- **v1 ships macOS builds unsigned and not notarized.** Gatekeeper blocks the first launch; users clear it via **System Settings → Privacy & Security → Security → Open Anyway**, or `xattr -dr com.apple.quarantine` (see §15 Known Risks). The Control-click → **Open** override was removed in macOS 15 Sequoia and must not be documented. Signing and notarization remain a later, secrets-only change.

---

## 8. Database Schema (SQLite + Prisma)

### 8.0 SQLite Setup

| Item         | Detail                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| DB file      | `app.getPath('userData')/sshclient.db`                                                                                                    |
| Set by       | Electron main — `process.env.DATABASE_URL = file:{path}`                                                                                  |
| Journal mode | WAL (enabled on init via `PRAGMA journal_mode=WAL`)                                                                                       |
| Migrations   | Applied on every startup via `better-sqlite3` directly (no Prisma CLI) — uses a `_prisma_migrations` table compatible with Prisma tooling |
| Backup       | User copies the `.db` file — it is self-contained                                                                                         |

### 8.1 Prisma Schema

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native"]
}

datasource db {
  provider = "sqlite"
  // Prisma 7: the connection URL is read from backend/prisma.config.ts (DATABASE_URL)
}

model Profile {
  id                String    @id @default(cuid())
  name              String
  host              String
  port              Int       @default(22)
  username          String
  authMethod        String              // "password" | "key" | "key+passphrase"
  encryptedPassword String?             // AES-256-GCM encrypted — null if key auth
  sshKeyId          String?
  group             String?
  terminalTheme     String    @default("dark")
  fontSize          Int       @default(14)
  autoReconnect     Boolean   @default(true)
  lastConnectedAt   DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  sshKey    SSHKey?    @relation(fields: [sshKeyId], references: [id], onDelete: SetNull)
  tunnels   Tunnel[]
  auditLogs AuditLog[]
}

model Tunnel {
  id         String  @id @default(cuid())
  profileId  String
  type       String              // "local" | "remote" | "dynamic"
  localPort  Int
  remoteHost String?             // null for dynamic SOCKS5
  remotePort Int?                // null for dynamic SOCKS5
  autoStart  Boolean @default(false)
  label      String?

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
}

model SSHKey {
  id                  String   @id @default(cuid())
  name                String
  description         String?
  keyType             String              // "rsa" | "ed25519"
  encryptedPrivateKey String              // AES-256-GCM encrypted blob
  publicKey           String              // Stored plaintext — public key is not secret
  fingerprint         String              // SHA-256 fingerprint display string
  hasPassphrase       Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  profiles Profile[]
}

model AuditLog {
  id            String   @id @default(cuid())
  type          String              // "connection" | "disconnection" | "sftp_upload" | "sftp_download"
  profileId     String?
  profileName   String?
  host          String?
  detail        String
  success       Boolean
  errorMessage  String?
  durationMs    Int?
  fileSizeBytes Int?
  timestamp     DateTime @default(now())

  profile Profile? @relation(fields: [profileId], references: [id], onDelete: SetNull)
}

model AppConfig {
  id                 String   @id @default("singleton")
  lockEnabled        Boolean  @default(false)
  masterPasswordHash String?             // bcrypt hash — null if lock disabled
  encryptionKeySalt  String              // PBKDF2 salt (hex) — generated on first run
  autoLockMinutes    Int      @default(15)
  logRetentionDays   Int      @default(90)
  theme              String   @default("dark")  // "dark" | "light" | "system"
  defaultFont        String   @default("JetBrains Mono")
  defaultFontSize    Int      @default(14)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

---

## 9. API Design

### 9.1 Base URL Construction (in renderer)

```typescript
const BASE_URL = `http://127.0.0.1:${window.api.backendPort}/api`

export const api = axios.create({ baseURL: BASE_URL })

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('jwt')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
```

### 9.2 Auth API

```
GET   /api/auth/status          → { configured: boolean, locked: boolean }
POST  /api/auth/setup           { password }  → First run: set master password (≥ 10 characters — BL-26) → { token }
POST  /api/auth/setup/skip                    → First run: skip lock (storage-key encryption) → { token }
POST  /api/auth/unlock          { password? } → Verify master password → { token }   (5 attempts/min)
POST  /api/auth/lock                          → Clear the active AES key, revoke all tokens, close terminals and SFTP progress streams (BL-18)   (JWT)
POST  /api/auth/setup-password  { password }  → Skip-lock install → enable lock; re-encrypts all secrets (FR-07.7); a new password needs ≥ 10 characters (BL-26)   (JWT)
POST  /api/auth/change-password { currentPassword, newPassword } → Re-encrypts all secrets under the new password in one transaction; 400 lock off / short or unchanged password, 401 wrong current password, 429 rate-limited (FR-07.8)   (JWT)
POST  /api/auth/disable-lock    { password }  → Verify master password, turn lock off; re-encrypts all secrets (FR-07.7)   (JWT)
```

Only `status`, `setup`, `setup/skip` and `unlock` are reachable without a JWT. Every `/api/auth/*` request must carry `X-CypherShell-Launch: <per-launch secret>` or gets `403` (BL-17). For every route, a `Host` other than `127.0.0.1` / `localhost` / `[::1]`, or an `Origin` other than `file://` and the dev server's, gets `403` before any route runs (BL-17).

### 9.3 Profiles API

```
GET    /api/profiles                  → List all profiles (no secrets; `hasPassword` flag)
POST   /api/profiles                  → Create profile
GET    /api/profiles/export ?ids=a,b  → Export bundle { version, exportedAt, profiles[] } (FR-09)
POST   /api/profiles/import           { profiles[], resolutions? } → { status: 'conflicts', conflicts } | { status: 'ok', created, skipped, overwritten }
GET    /api/profiles/:id              → Get single profile (with tunnels)
PUT    /api/profiles/:id              → Partial update — omitted fields are untouched; `password: ''` clears the stored password
DELETE /api/profiles/:id              → Delete profile
POST   /api/profiles/:id/duplicate    → Duplicate profile → the new profile
POST   /api/profiles/:id/connect      → Open SSH connection → { sessionId: string }; sets `lastConnectedAt` (BL-31)
GET    /api/profiles/:id/tunnels      → Saved port-forwarding rules (BL-34)
POST   /api/profiles/:id/tunnels      { type, localPort, remoteHost?, remotePort?, label? } → 201 rule | 400 | 409 if already saved (BL-34)
DELETE /api/profiles/:id/tunnels/:tunnelId → Delete a saved rule of this profile (BL-34)
```

### 9.4 Sessions API

```
GET    /api/sessions                  → { sessions: [{ id, profileId, profileName, host, connectedAt, consumers }] }
GET    /api/sessions/:sessionId       → { alive: boolean, state?: 'connected' | 'reconnecting' } — also renews the session's heartbeat lease (BL-11); `state` from BL-41
DELETE /api/sessions/:sessionId       → Disconnect session (closes its shells, SFTP and tunnels)
```

### 9.5 WebSocket — Terminal

```
WS  ws://127.0.0.1:{port}/ws/terminal/:sessionId?token=<JWT>&launch=<per-launch secret>

Upgrade refused:  403 — foreign Host or Origin, or missing/wrong launch secret (BL-17)
                  401 — missing, expired or revoked token (BL-18)
Close code 4001:  "App locked" — the app was locked; the renderer does not reconnect (BL-18)
Close code 4002:  "SSH connection lost" — the backend gave up reconnecting (or autoReconnect is off); the renderer does not reconnect (BL-41)
Server → Client status: { type: "status", state: "connected" | "reconnecting" | "disconnected" } — "reconnecting" while the backend re-creates the SSH connection (BL-41)

Client → Server:
  { type: "input",  data: "<base64 of UTF-8 bytes>" }
  { type: "resize", cols: 220, rows: 50 }
  { type: "ping" }

Server → Client:
  { type: "output", data: "<base64 of raw bytes>" }
  { type: "status", state: "connected" | "disconnected" }
  { type: "error",  message: "Connection refused" }
  { type: "pong" }
```

Each WebSocket opens its own shell channel on the session's SSH connection. "Reconnecting" is a client-side state.

### 9.6 SFTP API

```
GET    /api/sftp/:sessionId/list      ?path=.&showHidden=false               → { files[] }
GET    /api/sftp/:sessionId/realpath  ?path=.                                → { path } — the absolute path (BL-30)
POST   /api/sftp/:sessionId/upload    { local: { grant, name? }, remotePath, transferId } → { success, transferId } (progress via SSE; BL-47)
POST   /api/sftp/:sessionId/download  { remotePath, local: { grant }, transferId }        → { success, transferId } (progress via SSE; BL-47)
POST   /api/sftp/:sessionId/delete    { remotePath }                         → Delete file
POST   /api/sftp/:sessionId/rename    { oldPath, newPath }                   → Rename/move
POST   /api/sftp/:sessionId/mkdir     { remotePath }                         → Create directory
POST   /api/sftp/:sessionId/chmod     { remotePath, mode }                   → Change permissions (mode: octal string or number)
GET    /api/sftp/:sessionId/progress/:transferId ?token=<JWT>                → SSE progress stream
DELETE /api/sftp/:sessionId/transfer/:transferId                             → Cancel an in-progress transfer (BL-01)
```

Upload and download name a local file by grant, not by path and not as a multipart body (BL-47): `grant` is 32 hex characters issued by the main process; `name` (1–255 characters) names a file inside a local-pane folder grant. The backend asks main to resolve the grant; an invalid grant gets `400 { error, code }` (`GRANT_UNKNOWN`, `GRANT_MISMATCH`, `NAME_NOT_ALLOWED`, `REFUSED`, `NOT_FOUND`, `NOT_A_FILE`) and no answer from main gets `503` (`UNAVAILABLE`). A body with `localPath` or any other extra key gets `400`.

Validation (BL-23): `transferId` matches `^(up|dn)-[0-9a-z]{1,32}$` — `up-` for uploads, `dn-` for downloads — on upload, download, progress and cancel (`400` otherwise); starting a transfer whose id is in progress gives `409`. The path main resolves must be absolute; an upload source must be an existing regular file and a download target's folder must exist (the target must not be a folder) — `400` otherwise. Remote paths are non-empty, at most 4096 characters, without NUL; `mode` is 3–4 octal digits or an integer up to `0o7777`.

### 9.6a SFTP Progress — SSE

```
GET  /api/sftp/:sessionId/progress/:transferId
     Content-Type: text/event-stream
     Cache-Control: no-cache

Event stream:
  data: { "transferId": "up-…", "status": "progress",
          "bytesTransferred": 524288, "totalBytes": 2097152, "percent": 25 }

  data: { "transferId": "up-…", "status": "complete", "percent": 100 }

  data: { "transferId": "up-…", "status": "error", "message": "Permission denied" }

  data: { "transferId": "up-…", "status": "cancelled" }
```

Speed and elapsed time (FR-04.10) are computed in the renderer from successive progress events. The stream closes itself after 5 minutes without an event.

### 9.7 SSH Keys API

```
GET    /api/keys                      → List keys (no private key material in response)
POST   /api/keys/generate             { name, type: 'rsa' | 'ed25519', bits?: 2048 | 4096, passphrase?, description? }
POST   /api/keys/import               { name, privateKey, passphrase?, description? }  (PEM / OpenSSH / PPK)
GET    /api/keys/:id/usage            → { profiles: [{ id, name }] } — profiles that use the key (BL-03)
POST   /api/keys/:id/export-bundle    { passphrase, confirmPassphrase } → .cskb JSON envelope (FR-10)
POST   /api/keys/import-bundle        { bundle, passphrase, resolution? } → { status } | 409 { status: 'conflict', conflictName, profileCount }
DELETE /api/keys/:id                  → Delete key (linked profiles keep their profile, lose the key link)
```

### 9.8 Tunnels API

```
POST   /api/tunnels/:sessionId/start  { type: 'local' | 'remote' | 'dynamic', localPort, remoteHost?, remotePort? }   — 409 { code: 'PORT_IN_USE', port, error } if the local port is taken (BL-31)
POST   /api/tunnels/:sessionId/stop   { type, port }   — port is localPort for local/dynamic, remotePort for remote
```

Validation (BL-23): ports are integers 1–65535, as numbers or digit strings (the UI sends strings); `remoteHost` (no whitespace or control characters, at most 255) is required for `local`; `remotePort` for `local` and `remote`. Anything else gets `400`.

### 9.9 Audit Logs API

```
GET    /api/audit     ?page=1&pageSize=50&type=&from=&to=&q=  → { items, total, page, pageSize }, newest first (BL-32)
GET    /api/audit/export              → All entries as CSV (text/csv); the Logs page saves it via dialog:saveTextFile (BL-28)
DELETE /api/audit                     → Clear all logs (BL-06)
```

> `type` is one of `connection`, `disconnection`, `sftp_upload`, `sftp_download`, `key_used`, `host_key`; `from`/`to` are ISO dates; `q` searches detail, type, profile, host and error. `pageSize` is at most 200; invalid parameters answer 400.

### 9.10 App Config API

```
POST   /api/profiles/:id/connect → { sessionId }; body { acceptHostKey? } (a "SHA256:…" fingerprint the user confirmed). 409 { code: 'HOST_KEY_UNKNOWN' | 'HOST_KEY_MISMATCH', host, port, keyType, fingerprint, knownKeyType?, knownFingerprint?, error } when the host key is new or changed (BL-38)
GET    /api/known-hosts        → Trusted SSH host keys, newest lastSeenAt first (BL-38)
DELETE /api/known-hosts/:id    → Forget a host key; 404 for an unknown id (BL-38)
GET    /api/config    → { theme, defaultFont, defaultFontSize, logRetentionDays, lockEnabled, hasMasterPassword, autoLockMinutes, … }
PUT    /api/config    → Update theme, fonts, autoLockMinutes, logRetentionDays
```

`masterPasswordHash` and `encryptionKeySalt` are never returned. `lockEnabled` is read-only here — it changes only through `POST /api/auth/setup-password` and `POST /api/auth/disable-lock` (FR-07.7).

Validation (BL-23): `theme` ∈ `dark | light | system`, `defaultFont` 1–200 characters, `defaultFontSize` 8–72, `logRetentionDays` 0–3650, `autoLockMinutes` 1–1440, otherwise `400`. Other keys are ignored. A saved change republishes the auto-lock policy to the main process (BL-18).

---

## 10. Security Requirements

### 10.1 Encryption At Rest

| Data             | Column                         | Method                 |
| ---------------- | ------------------------------ | ---------------------- |
| SSH passwords    | `Profile.encryptedPassword`    | AES-256-GCM            |
| SSH private keys | `SSHKey.encryptedPrivateKey`   | AES-256-GCM            |
| Master password  | `AppConfig.masterPasswordHash` | bcrypt cost 12         |
| Public keys      | `SSHKey.publicKey`             | Plaintext (not secret) |

### 10.2 Key Derivation

```
masterPassword + encryptionKeySalt
    → PBKDF2-SHA512, 200,000 iterations
    → 256-bit AES key (memory only — never written to disk)
        → AES-256-GCM encrypt/decrypt of all secret fields
```

### 10.3 What Never Reaches the Renderer

- Raw private key content
- Decrypted passwords or passphrases
- The derived AES key
- The JWT secret — it exists only in the backend process's memory (BL-19)

The renderer does hold the per-launch secret (BL-17): it proves a request comes from CypherShell's own renderer, so a script already running in the renderer gains nothing from it.

### 10.4 Network Binding

Express bound to `127.0.0.1:{port}` — not `0.0.0.0`. The port is not externally reachable. Local web pages are kept out too: a foreign `Host` (DNS rebinding) or `Origin` gets `403`, and `/api/auth/*` and the terminal WebSocket need the per-launch secret (BL-17).

### 10.5 Rate Limiting

| Endpoint                | Limit             |
| ----------------------- | ----------------- |
| `POST /api/auth/unlock` | 5 attempts/minute |
| All other API endpoints | 300 req/minute    |

### 10.6 Input Validation

- All request bodies validated with `zod` schemas ✅ (BL-23 — SFTP, tunnel and config joined the profile, auth and key controllers)
- SSH hostnames validated against RFC 1123 ⚠️ — not implemented; any non-empty host is accepted (tracked, not scheduled)
- Ports validated (1–65535) ✅ for profiles, imported tunnels and tunnel start/stop (BL-23)
- SFTP local files are named by grants that the main process issued and resolves (BL-47); the resolved path is validated — absolute, normalized, a regular file to upload, an existing folder to download into ✅ (BL-23). Remote paths are only checked for well-formedness: for a user with shell access, remote `..` is not a security boundary
- SFTP `transferId` restricted to `up-…` / `dn-…` — it names an `EventEmitter` event ✅ (BL-23)

### 10.7 Electron Security

- `contextIsolation: true` — renderer has no direct Node.js access
- `nodeIntegration: false` in renderer
- All Node.js APIs exposed only via typed `contextBridge` surface
- Standalone connection windows receive the JWT through a one-time IPC hand-off (`get-connection-token`), keyed by the window — no credential in the window URL or window state ✅ (BL-20)
- Every window denies `window.open` (http(s) links open in the system browser) and navigation outside the app; every IPC handler serves only a top-level frame showing the app's renderer ✅ (BL-21)
- The renderer has no generic IPC passthrough and no call that reads or writes a path it supplies; text export/import is bound to native dialogs run by main ✅ (BL-22); SFTP local files are granted by main and only SFTP windows receive grants ✅ (BL-47)

---

## 11. UI/UX Requirements

### 11.1 Application Layout

```
┌──────────────────────────────────────────────────────────┐
│  ● ● ●   CypherShell                      [_]  [□]  [X] │  ← OS window title bar (native frame)
├──────────────────────────────────────────────────────────┤
│  [update banner — shown when update available]           │
├───────────┬──────────────────────────────────────────────┤
│           │  [Home]  [server1 ●]  [server2 ●]  [+]      │  ← Tab Bar (DnD reorder)
│  Sidebar  ├──────────────────────────────────────────────┤
│           │                                              │
│  Profiles │          Active Tab Content                  │
│  Keys     │   (Home / Profile Detail / Settings / etc.)  │
│  Logs     │                                              │
│  Settings │                                              │
│           │                                              │
└───────────┴──────────────────────────────────────────────┘
```

Standalone windows (terminal / SFTP) open independently, sized to fill screen.

### 11.2 Colour Themes

- **Dark** (default): `#1a1a1a` bg, `#e5e7eb` text, green terminal cursor
- **Light**: `#ffffff` bg, `#111827` text ✅ (BL-35 — `.light` overrides in `main.css`; the theme applies as soon as it is saved in Settings, and "System" follows the OS)
- **System**: follows OS preference (`prefers-color-scheme`)
- **Terminal schemes** (6 options): Default Dark, Dracula, Nord, Solarized Dark, Monokai, One Dark

### 11.3 Typography

- UI font: system font stack (SF Pro / Segoe UI / Ubuntu)
- Terminal font: JetBrains Mono — bundled as a local font asset, not fetched from CDN ✅ (BL-35 — `@fontsource/jetbrains-mono`, regular and bold Latin subsets, bundled by the renderer build; OFL-1.1; CSP `font-src 'self'`)
- Terminal font size: 10–24px, configurable in Settings

### 11.4 Required UI States

| State   | Treatment                                      |
| ------- | ---------------------------------------------- |
| Loading | Skeleton screen or spinner — never blank white |
| Empty   | Empty state with clear call-to-action          |
| Error   | Red toast + inline message + retry button      |
| Success | Green toast, auto-dismiss after 3 seconds      |

### 11.5 shadcn/ui Components

Copy-owned in `src/renderer/src/components/ui/`: `Badge`, `Button`, `Dialog`, `DropdownMenu`, `Input`, `Progress`, `ScrollArea`, `Select`, `Separator`, `Sheet`, `Skeleton`, `Sonner` (toasts), `Table`, `Tabs`, `Tooltip`.

⚠️ App code imports only `Sonner`, plus `Dialog`, `Input` and `Button` for the SFTP input dialog (BL-14); other screens still hand-roll their modals and selects (tracked, not scheduled).

---

## 12. Development Phases

### Phase 1 — Foundation ✅ Complete

- Scaffold with electron-vite React + TypeScript
- Tailwind CSS + shadcn/ui initialized
- Express backend: health check, portfinder, Prisma + SQLite init
- Electron main spawns backend, passes port to renderer via preload
- App lock: master password setup wizard + lock screen + JWT auth
- SetupWizard page for first-run configuration

**Deliverable:** App launches, lock screen works, renderer talks to backend ✅

---

### Phase 2 — Profiles + SSH Terminal ✅ Complete

- Profile CRUD: list, create, edit, delete, duplicate (UI + API)
- SSH connection via ssh2 + WebSocket bridge
- xterm.js terminal pane with PTY resize (`xterm-addon-fit`)
- Profile Detail tab with connect/disconnect lifecycle
- Connection status indicator (connected / reconnecting / disconnected)
- Standalone terminal windows with JWT propagation

**Deliverable:** Connect to any SSH server and run interactive commands ✅

---

### Phase 3 — Multi-Tab + SFTP ✅ Complete

- Tab bar: open, close, reorder (Zustand tabStore + `@hello-pangea/dnd`)
- SFTP dual-pane file manager (local + remote)
- Upload, download, rename, delete, mkdir, chmod
- Real-time transfer progress via SSE
- Transfer queue with history and retry
- LocalFilePane for local filesystem browsing

**Deliverable:** Full multi-session SSH + complete SFTP workflow ✅

---

### Phase 4 — Keys + Port Forwarding ✅ Complete

- SSH Key Manager: generate RSA/ED25519, import PEM/OpenSSH/PPK
- Assign keys to profiles; key selector in ProfileForm
- Port forwarding: local, remote, dynamic SOCKS5
- Tunnel panel inline in ProfileDetailPane
- Auto-reconnect with exponential backoff

**Deliverable:** Full key management, tunneling, and stable reconnection ✅

---

### Phase 5 — Polish + Packaging ✅ Complete

- Audit log viewer, filter, CSV export
- Terminal theme selector (6 themes)
- Settings page (theme, font, lock timeout, log retention)
- Auto-updater (`electron-updater`) + UpdateBanner component
- Build pipeline: `.exe` (Windows), `.dmg` (macOS), `.AppImage` (Linux)
- README + open-source documentation
- Installer size optimization: esbuild bundles backend, Prisma CLI removed, migrations applied via `better-sqlite3` at runtime — Windows installer reduced from ~450 MB → ~101 MB

**Deliverable:** Shippable v1.0 ✅

---

### Phase 6 — v1.1 Refinements 🔄 In Progress

See §17 for the full backlog.

---

## 13. Dependencies & Libraries

### Renderer

```
react-router-dom          v7   HashRouter for Electron file:// compat
tailwindcss               v3.4
class-variance-authority       shadcn/ui dep
clsx, tailwind-merge
lucide-react              v1.16 Icons
@xterm/xterm              v6
@xterm/addon-fit               Resize PTY on window resize
@xterm/addon-web-links         Clickable URLs in terminal
@xterm/addon-search            Ctrl+F in terminal
@fontsource/jetbrains-mono     Bundled terminal font (BL-35, OFL-1.1)
zustand                   v5
@tanstack/react-query     v5
axios                     v1.16
date-fns
zod                            (declared, not imported by the renderer)
sonner                         Toast notifications
react-dropzone                 (declared, not imported — drag-and-drop uses native DOM events)
@hello-pangea/dnd              Tab drag-to-reorder
```

### Backend

```
express                   v5
cors
ws                             WebSocket server
ssh2                           SSH client; also generates OpenSSH keypairs (BL-12)
ssh2-sftp-client               SFTP operations
@prisma/client                 ORM client (Prisma 7)
@prisma/adapter-better-sqlite3 Driver adapter for better-sqlite3
better-sqlite3                 SQLite native driver (used by Prisma)
bcryptjs                       Master password hashing (pure JS)
jsonwebtoken                   JWT
zod                            Request body validation
express-rate-limit             Rate limiting
multer                         (declared, not imported — uploads take a local path, not multipart)
node-forge                     (declared, not imported — keys are generated by ssh2)
sshpk                          Key parsing, fingerprints, PPK/PKCS#8 → OpenSSH conversion
portfinder                     (declared in backend, not imported — the main process picks the port)
```

### Electron + Build

```
electron                  v39
electron-vite             v5.0
electron-builder          v26
electron-updater          v6.8
```

---

## 14. Out of Scope (v1)

| Feature                     | Reason                             | Target       |
| --------------------------- | ---------------------------------- | ------------ |
| Cloud profile sync          | Needs backend infrastructure       | v2           |
| Team / shared vaults        | Requires multi-user auth model     | v2           |
| SSH agent forwarding        | Complex OS keychain integration    | v2           |
| Mosh protocol               | Completely different protocol      | Out of scope |
| Serial / Telnet             | Out of product vision              | Out of scope |
| Built-in remote file editor | Download → edit → upload covers it | v2           |
| In-app `ssh-copy-id`        | Nice to have                       | v2           |
| Macro / script recording    | Feature expansion                  | v2           |
| Terminal session replay     | Feature expansion                  | v2           |
| Snap / Flatpak packaging    | AppImage covers Linux for v1       | v2           |
| Jump host / ProxyJump       | Multi-hop SSH                      | v2           |

---

## 15. Known Risks

| Risk                                                | Impact     | Mitigation                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssh2` failures on unusual SSH server configs       | Medium     | Wrap all connections in try/catch; expose raw error in UI                                                                                                                                                                                                            |
| xterm.js perf with very high output (log tail)      | Medium     | Enable WebGL renderer addon; implement output throttling                                                                                                                                                                                                             |
| PPK import accuracy across PPK format versions      | Low–Medium | Test with real PuTTY PPK v2/v3 files; sshpk handles both                                                                                                                                                                                                             |
| `better-sqlite3` native binary bundling in Electron | Resolved   | `better-sqlite3` 13 ships N-API prebuilds; `after-pack.cjs` keeps only the target's binary and checks its architecture (BL-36, ADR-003)                                                                                                                              |
| SQLite corruption on OS force-kill                  | Low        | WAL mode enabled on DB init                                                                                                                                                                                                                                          |
| Prisma engine binary missing in packaged app        | Medium     | Resolved — `binaryTargets = ["native"]` only; Prisma CLI not shipped; migrations applied via `better-sqlite3` at startup                                                                                                                                             |
| Electron bundle > 200MB                             | Resolved   | esbuild bundles backend pure-JS deps inline; installer is ~101 MB                                                                                                                                                                                                    |
| Windows SFTP path separator issues                  | Medium     | Always use `path.posix` for remote paths                                                                                                                                                                                                                             |
| Port collision on backend auto-assign               | Low        | `portfinder` scans from 4000 upward                                                                                                                                                                                                                                  |
| macOS Gatekeeper blocks unsigned builds             | Medium     | Builds are unsigned by design (ADR-004). Users clear it via **System Settings → Privacy & Security → Security → Open Anyway**, or `xattr -dr com.apple.quarantine`. The Control-click → **Open** override was removed in macOS 15 Sequoia and must not be documented |

---

## 16. Implementation Status

Current build state after BL-44 (Phases 4–5, 2026-11). A row returns to ✅ when its backlog item lands.

| Module                     | Status      | Notes                                                                                                                                                          |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron main process      | ✅ Complete | Backend spawn + crash restart (BL-16), IPC (sender-checked, BL-21), single instance (BL-25), idle lock (BL-18), auto-updater (BL-24), rotating app.log (BL-43) |
| Preload / contextBridge    | ✅ Complete | Typed window.api only — no generic IPC passthrough or path-based file calls (BL-22)                                                                            |
| App auth state machine     | ✅ Complete | loading → setup/locked/unlocked flow; re-auth on 401 / backend restart (BL-10, BL-16); lock on `app:locked` (BL-18)                                            |
| SetupWizard page           | ✅ Complete | First-run master password setup; 10-character minimum + strength hint (BL-26)                                                                                  |
| LockScreen page            | ✅ Complete | Unlock with bcrypt verify + JWT                                                                                                                                |
| Home page / Profile grid   | ✅ Complete | Search, filter, CRUD, duplicate, export/import                                                                                                                 |
| ProfileDetailPane          | ✅ Complete | Connect/disconnect, tunnel panel, window spawning                                                                                                              |
| ProfileForm                | ✅ Complete | Create/edit with key selector; edits send only changed fields (BL-13)                                                                                          |
| TerminalPane (xterm.js)    | ✅ Complete | WebSocket I/O (UTF-8, BL-15), resize, themes, search                                                                                                           |
| TabBar                     | ✅ Complete | DnD reorder, close, Home anchor tab                                                                                                                            |
| SftpPane (dual-pane)       | ✅ Complete | All file ops via in-app dialogs, progress, transfer queue (BL-14)                                                                                              |
| LocalFilePane              | ✅ Complete | Local FS browsing via Electron IPC (home directory only); grants and refused app-data folders in BL-47                                                         |
| Keys page                  | ✅ Complete | Generate, import, copy, export, delete, export/import .cskb bundle                                                                                             |
| Logs page                  | ✅ Complete | Server-side filters and paging (BL-32); CSV export via save dialog (BL-28)                                                                                     |
| Settings page              | ✅ Complete | Theme, font, lock (re-encrypting, BL-10; 10-character minimum, BL-26), change master password (BL-39), known hosts (BL-38), retention                          |
| UpdateBanner               | ✅ Complete | Auto-update notification + install; Releases link on macOS (BL-24)                                                                                             |
| SSH service                | ✅ Complete | Session pool, password (+ keyboard-interactive, BL-40) and key auth, host-key verification (BL-38), automatic reconnect (BL-41), consumer-aware reaper (BL-11) |
| SFTP service               | ✅ Complete | All file ops + SSE progress; one channel per transfer (BL-14)                                                                                                  |
| Crypto service             | ✅ Complete | AES-256-GCM + PBKDF2 (master key + passphrase-based)                                                                                                           |
| Key service                | ✅ Complete | OpenSSH generation (BL-12), import + conversion, fingerprint, .cskb export/import                                                                              |
| Tunnel service             | ✅ Complete | Local, remote, dynamic SOCKS5; socket errors handled (BL-16)                                                                                                   |
| Audit service              | ✅ Complete | Event logging with disconnect reasons, filtered paging, CSV with formula guard (BL-28, BL-32)                                                                  |
| Config service             | ✅ Complete | AppConfig singleton read/update; never creates the row (BL-10)                                                                                                 |
| Profile service            | ✅ Complete | Export payload builder, conflict check, import with resolution                                                                                                 |
| WebSocket terminal handler | ✅ Complete | Bidirectional base64 SSH I/O; consumer counting (BL-11); caller + revocation checks, closes on lock (BL-17, BL-18)                                             |
| Auth middleware            | ✅ Complete | JWT (HS256, `jti` required — BL-19) + query-param fallback for SSE; caller checks (BL-17)                                                                      |
| Rate limiting              | ✅ Complete | 5/min unlock, 300/min API                                                                                                                                      |
| Database schema            | ✅ Complete | 5 models, Prisma migrations, WAL mode                                                                                                                          |
| Build pipeline             | ✅ Complete | Win/Linux/macOS installers via CI matrix (NFR-07); ~101 MB (esbuild + runtime migrations)                                                                      |

---

## 17. v1.1 Backlog — Unimplemented Requirements

BL-01 … BL-09 are the v1.0 gaps scheduled for v1.1. BL-10 … BL-16 come from the spec audit of 2026-11-10, which found requirements marked ✅ whose implementation does not work. All seven were implemented the same day, each with regression tests. BL-17 … BL-26 are the audit's second phase, security hardening: they implement the NFR-02 additions in §7. BL-27 is a test-only fix found while verifying them: the Playwright e2e suite runs on a throwaway profile instead of the user's real one. BL-28 repairs the audit-log CSV export (FR-08.6), which sent no token and, once BL-21 blocked navigation, did nothing. Smaller gaps found by the same audit are recorded as ⚠️ notes on their requirement in §6/§7 ("tracked, not scheduled").

---

### ~~BL-01 — Cancel In-Progress SFTP Transfer~~ ✅ Implemented

**Requirement:** FR-04.16
**Priority:** High — **Done in v1.1**

Implemented: `DELETE /api/sftp/:sessionId/transfer/:transferId` → `SftpService.cancelTransfer()` destroys the underlying ssh2 SFTPStream, emits `{ status: 'cancelled' }` on the SSE channel, and cleans up the `activeTransfers` Map. The `SftpPane` cancel button calls the endpoint and the `transferStore` reflects the cancelled state immediately.

The destroyed stream was the session's shared SFTP channel, so cancelling one transfer broke the others; since BL-14 each transfer has its own channel.

---

### ~~BL-02 — Port Conflict Detection~~ ✅ Implemented (backend)

**Requirement:** FR-06.6
**Priority:** Medium

Implemented: `TunnelService.checkPort()` probes `127.0.0.1:localPort` before local and dynamic forwards and rejects with "Port N is already in use".

Completed by BL-31: the API answers `409 { code: 'PORT_IN_USE', port }` and `ProfileDetailPane` names the busy port.

---

### ~~BL-03 — In-Use Key Delete Warning~~ ✅ Implemented

**Requirement:** FR-05.11
**Priority:** Medium

Implemented: `GET /api/keys/:id/usage` returns the profiles that reference the key, and `Keys.tsx` lists them in the delete confirmation. Deleting sets those profiles' `sshKeyId` to `NULL` (`onDelete: SetNull`).

---

### ~~BL-04 — Audit Log Auto-Purge~~ ✅ Implemented

**Requirement:** FR-08.7
**Priority:** Medium

Implemented: logs older than `AppConfig.logRetentionDays` are purged at startup and every 24 hours.

⚠️ The startup run read the config through `ConfigService.getConfig()`, which inserts the row when it is missing — on a fresh install this skipped the setup wizard. Fixed by BL-10.

---

### ~~BL-05 — SSH Disconnect Reason Logging~~ ✅ Implemented

**Requirement:** FR-08.2
**Priority:** Low

Implemented: disconnects are logged with their duration.

Completed by BL-32: the reason is recorded (user, idle timeout, error, closed by remote) and an error after connecting no longer writes extra entries.

**Backend work:** In `SshService`, record why a session ends (`user` from `DELETE /api/sessions/:id`, `timeout` from the reaper, `error` from the client `error` event), log one disconnect entry from the `close` handler, and detach the pre-ready listeners once `ready` fires.

---

### ~~BL-06 — Clear All Logs Endpoint~~ ✅ Implemented

**Requirement:** FR-08.8
**Priority:** Low

Implemented: `DELETE /api/audit` (the audit API is mounted at `/api/audit`, not `/api/logs`) → `AuditService.clearAllLogs()`, plus a "Clear All" button with confirmation in `Logs.tsx`.

---

### ~~BL-07 — SFTP Keyboard Shortcuts~~ ✅ Implemented

**Requirements:** FR-04.6 (F2 rename), FR-04.8 (Ctrl+Shift+N new folder)
**Priority:** Low

Implemented: `SftpPane.tsx` handles F2 on the selected file and Ctrl+Shift+N while the remote pane has focus.

Both shortcuts first opened `window.prompt()`, which Electron does not implement; since BL-14 they open the in-app input dialog.

---

### ~~BL-08 — Terminal Right-Click Paste~~ ✅ Implemented

**Requirement:** FR-02.4
**Priority:** Low

Implemented: a `contextmenu` listener on the xterm container reads `navigator.clipboard.readText()` and sends the text as UTF-8 input over the WebSocket.

---

### ~~BL-09 — Terminal Auto-Copy on Selection~~ ✅ Implemented

**Requirement:** FR-02.11
**Priority:** Medium

Selecting text in the terminal copies it to the system clipboard, the standard Unix/Linux terminal behaviour where selection = copy.

**Requirements:**

- FR-02.11.1 — Click-and-drag (mouse) selection in the terminal automatically copies the selected text to the system clipboard on mouse release ✅
- FR-02.11.2 — Double-click (word) and triple-click (line) selection also trigger auto-copy ✅
- FR-02.11.3 — An empty or cleared selection does not overwrite the clipboard with an empty string ✅

**Implementation:** `TerminalPane.tsx` listens to `terminal.onSelectionChange()` and, when `terminal.hasSelection()` is true, writes `terminal.getSelection()` with `navigator.clipboard.writeText()`. No backend or IPC changes.

---

### ~~BL-10 — Auth & Lock Lifecycle~~ ✅ Implemented

**Requirements:** FR-07.1, FR-07.7, FR-08.7
**Priority:** Critical
**Status:** ✅ Implemented 2026-11-10 — regression tests: `tests/backend/bootstrap.test.ts`, `tests/backend/lockMode.test.ts`, `tests/renderer/pages/Settings.test.tsx`

**Problems:**

1. `ConfigService.getConfig()` inserts the AppConfig row when it is missing, and the startup log purge calls it. On a fresh install the row exists before the renderer asks, so `GET /api/auth/status` returns `{ configured: true, locked: false }`, the renderer auto-unlocks, and the setup wizard never appears. A second purge in `initDatabase()` duplicates the job and mutates the DB outside a service.
2. `POST /api/auth/setup-password` replaces the salt and key without re-encrypting stored secrets, and turning lock off through `PUT /api/config { lockEnabled: false }` makes the next unlock derive a different key. Either way every stored password and private key becomes undecryptable after a restart. The Settings toggle decides whether a master password exists from a field the API never returns, so lock cannot be turned back on.

**Backend work:**

- The purge reads the config without creating it; remove the duplicate purge from `db.ts`. `ConfigService.getConfig()` returns `null` instead of inserting.
- Add `CryptoService.encryptWith(key, text)` / `decryptWith(key, text)` and a `SecretsService.rekey(oldKey, newKey, configUpdate)` that re-encrypts every `Profile.encryptedPassword` and `SSHKey.encryptedPrivateKey` and applies the config change in one `prisma.$transaction`.
- `POST /api/auth/setup-password` re-encrypts from the storage key to the new master-password key. New `POST /api/auth/disable-lock { password }` verifies the master password, re-encrypts to the storage key, and clears `masterPasswordHash`.
- `GET /api/config` returns `hasMasterPassword`; `PUT /api/config` no longer changes `lockEnabled`.

**Frontend work:** `Settings.tsx` uses `hasMasterPassword`: enabling lock opens the set-password dialog, disabling asks for the current password and calls `disable-lock`. Home shows a dismissible banner while lock is off.

**Acceptance Criteria:**

- [x] On a fresh database, after startup jobs run, `GET /api/auth/status` returns `configured: false` and `POST /api/auth/setup` succeeds
- [x] A secret stored on a skip-lock install still decrypts after setting a master password and restarting
- [x] After turning lock off with the correct password and restarting, the secret still decrypts; a wrong password changes nothing
- [x] Lock can be turned on again after it was turned off

---

### ~~BL-11 — SSH Session Lifecycle~~ ✅ Implemented

**Requirements:** FR-02.8, FR-03.5, FR-06.5
**Priority:** Critical
**Status:** ✅ Implemented 2026-11-10 — regression tests: `tests/backend/sessions.test.ts`, `tests/renderer/hooks/useSessionHeartbeat.test.tsx`

**Problem:** The terminal WebSocket took the session id from the raw request URL, which since SEC-03 (2026-07-23) ends in `?token=…`, so every terminal was rejected with "Invalid session ID" and never attached. The orphan reaper closes any session whose `lastConsumedAt` is older than 60 s, but that timestamp is refreshed only when the session is looked up — once when a terminal WebSocket connects, never while it is in use, and never for the cached SFTP client. Terminals, SFTP windows and tunnels are killed 60–75 s after they open. Separately, every shell that closes schedules `removeSession()` 15 s later, closing the whole SSH connection with its other windows and tunnels.

**Backend work:**

- `SSHService.acquire(sessionId)` / `release(sessionId)` count live consumers: each terminal shell, the cached SFTP client and each running tunnel.
- `GET /api/sessions/:sessionId` returns `{ alive }` and renews a heartbeat lease, so an open Profile Detail tab keeps its session even with no window open.
- The reaper removes a session only when it has no consumers and no heartbeat for 60 s. Remove the 15 s `scheduleCleanup()`.

**Frontend work:** `ProfileDetailPane` polls `GET /api/sessions/:sessionId` every 15 s while connected and switches to Disconnected when the session is gone.

**Acceptance Criteria:**

- [x] A session with an open shell is never reaped, however long it stays idle
- [x] A session with no consumers and no heartbeat is reaped after 60 s
- [x] Closing one of two terminal windows leaves the other window and the session's tunnels working

---

### ~~BL-12 — SSH Key Formats~~ ✅ Implemented

**Requirements:** FR-05.1, FR-05.4, FR-05.6
**Priority:** Critical
**Status:** ✅ Implemented 2026-11-10 — regression tests: `tests/backend/keyFormats.test.ts`, `tests/renderer/components/keys/KeyGeneratorModal.test.tsx`

**Problem:** Generated keys are written as PKCS#8 (`-----BEGIN PRIVATE KEY-----`). ssh2 1.17 parses only OpenSSH, PKCS#1/SEC1 PEM and PPK v2 (RSA/DSS) private keys, so connecting with a generated key fails with "Unsupported key format". RSA is fixed at 2048 bits, the passphrase entered at generation is ignored while `hasPassphrase` is set, and imports are stored unconverted.

**Backend work:**

- Generate with `ssh2.utils.generateKeyPairSync(type, { bits, passphrase, cipher })` — OpenSSH output that ssh2 always parses. `POST /api/keys/generate` accepts `bits: 2048 | 4096` for RSA.
- On import, keep the key as supplied when `ssh2.utils.parseKey` accepts it (with its passphrase, if any). Otherwise convert it to OpenSSH with sshpk, decrypting with the supplied passphrase; the converted key is stored without a passphrase (AES-256-GCM at rest still applies) and `hasPassphrase` is `false`.
- When `SSHService` meets a stored key ssh2 cannot parse (keys generated before this fix), convert it to OpenSSH and save the converted key.

**Frontend work:** `KeyGeneratorModal` offers RSA 2048 and RSA 4096.

**Acceptance Criteria:**

- [x] Every generated key (ED25519, RSA 2048, RSA 4096, with and without passphrase) passes `ssh2.utils.parseKey` and authenticates against an SSH server
- [x] PKCS#8 and OpenSSH imports authenticate against an SSH server
- [x] A key stored in the old PKCS#8 format is converted on first use and the connection succeeds

---

### ~~BL-13 — Profile Form Edits~~ ✅ Implemented

**Requirements:** FR-01.1, FR-01.8.4
**Priority:** Critical
**Status:** ✅ Implemented 2026-11-10 — regression tests: `tests/renderer/components/profiles/ProfileForm.test.tsx`

**Problem:** `ProfileForm` submits every field, including `password: ''`. The API reads an explicit empty password as "clear the stored password", so saving any edit erases it. The auth method select offers only Password and SSH Key.

**Frontend work:** In edit mode, send only fields that differ from the loaded profile; send `password` only when the user typed one. Add a "SSH Key + Passphrase" option, with the passphrase input shown for that method. **No backend change** — the API contract (omitted = keep, `''` = clear) is correct and covered by tests.

**Acceptance Criteria:**

- [x] Editing only the name sends `{ name }` and the stored password survives
- [x] Typing a new password sends it; switching to SSH Key sends `sshKeyId` and no password
- [x] "SSH Key + Passphrase" can be selected and saved

---

### ~~BL-14 — SFTP Reliability~~ ✅ Implemented

**Requirements:** FR-04.6, FR-04.8, FR-04.9, FR-04.11, FR-04.16
**Priority:** Critical
**Status:** ✅ Implemented 2026-11-10 — regression tests: `tests/backend/sftpTransfers.test.ts`, `tests/renderer/components/sftp/SftpPane.test.tsx`

**Problems:**

1. Rename (button and F2), New Folder (button and Ctrl+Shift+N) and chmod call `window.prompt()`, which Electron does not implement.
2. Each session caches one SFTP channel for every operation. `cancelTransfer()` destroys that channel, failing the session's other transfers, and later listings keep using the dead cached client.

**Backend work:** Each upload and download opens its own SFTP channel on the session's SSH connection and closes it when the transfer finishes or is cancelled; cancel destroys only that channel. The cached client used for listings is dropped when its channel closes, so the next operation opens a new one.

**Frontend work:** New `components/sftp/InputDialog.tsx` built on the copy-owned `Dialog`, `Input` and `Button`; rename, new folder and chmod use it. F2 and Ctrl+Shift+N keep working.

**Acceptance Criteria:**

- [x] New Folder, Rename and chmod open an in-app dialog and perform the operation
- [x] Cancelling one of two running transfers leaves the other running, and the next directory listing works

---

### ~~BL-15 — Terminal Text Encoding~~ ✅ Implemented

**Requirement:** FR-02.2
**Priority:** Critical
**Status:** ✅ Implemented 2026-11-10 — regression tests: `tests/renderer/lib/terminalCodec.test.ts`

**Problem:** Terminal output is decoded with `atob()` and written as a Latin-1 string, so multi-byte UTF-8 renders as garbage; input is encoded with `btoa()`, which throws for characters outside Latin-1.

**Frontend work:** New `lib/terminalCodec.ts`: `encodeInput(text)` (UTF-8 via `TextEncoder`, then base64) and `decodeOutput(base64)` (to `Uint8Array`, passed to `terminal.write()`, which decodes UTF-8 and handles sequences split across messages). `TerminalPane` uses both for typing, paste and output. **No backend change** — the server already relays raw bytes.

**Acceptance Criteria:**

- [x] `é`, `─`, CJK and emoji survive an encode/decode round trip
- [x] `encodeInput` never throws for any string
- [x] Output split in the middle of a multi-byte character renders correctly

---

### ~~BL-16 — Tunnel Stability & Backend Auto-Restart~~ ✅ Implemented

**Requirements:** FR-06.1–FR-06.3, NFR-03
**Priority:** Critical
**Status:** ✅ Implemented 2026-11-10 — regression tests: `tests/backend/tunnelStability.test.ts`, `tests/backend/backendSupervisor.test.ts`, `tests/renderer/lib/api.test.ts`

**Problems:** Local-forward client sockets and their SSH channels have no `error` listeners, so a client that resets a forwarded connection raises an unhandled error that kills the backend and every session. Electron main only logs the child's exit; NFR-03's auto-restart does not exist, and the renderer has no handling for the resulting 401s.

**Backend work:** `error` listeners on every forwarded socket and SSH channel (local, remote, dynamic); log `unhandledRejection` instead of crashing.

**Main-process work:** New `src/main/backendSupervisor.ts` (no Electron imports, unit-testable) restarts the backend after an unexpected exit, on the same port, with backoff 1 s → 2 s → 4 s → 8 s, giving up after 5 failures within 2 minutes. After a restart main sends `backend:restarted` to every window — exposed in `src/preload/index.ts` **and** `src/preload/index.d.ts` as `onBackendRestarted(cb)`.

**Frontend work:** An Axios response interceptor in `lib/api.ts` treats a 401 (other than a failed unlock) as an expired session and re-runs the auth status check: lock off → re-issue a token, lock on → lock screen. `backend:restarted` triggers the same check.

**Acceptance Criteria:**

- [x] A client that resets a forwarded connection does not stop the backend
- [x] Killing the backend process restarts it, and the main window recovers without restarting the app
- [x] After repeated crashes the supervisor gives up instead of looping

---

### Phase 2 — Security Hardening (BL-17 … BL-26)

The second phase of the 2026-11-10 audit. Each item closes one of the NFR-02 additions in §7 (or the NFR-03 / NFR-07 gap it names). Two facts measured on Electron 39 (Windows) shape BL-17 and BL-21: a `file://` renderer sends **no** `Origin` header (and no CORS preflight) on `fetch`, XHR or `EventSource`, but sends `Origin: file://` on a WebSocket upgrade; and `event.senderFrame.url` is the page URL even for a `sendSync` made while the preload runs.

All ten were implemented on 2026-11-11. Besides the unit and integration tests named on each item, the built app (`out/main/index.js`, unpackaged, separate `--user-data-dir`) was driven end to end on Windows with Playwright: setup refused a 9-character password, `/api/auth/status` without the launch secret got 403, a terminal window connected with its token handed over by IPC (none in its URL), a second launch exited with code 0, a lock closed the terminal window and showed the lock screen, a 1-minute auto-lock fired after 63 s without input, and navigation and `window.open` were blocked. Not verified: the packaged build (backend under `ELECTRON_RUN_AS_NODE`) and anything on macOS or Linux desktops.

---

### ~~BL-17 — Local API Caller Authentication~~ ✅ Implemented

**Requirement:** NFR-02 (local API accepts only CypherShell's renderer), §10.4
**Priority:** Critical
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/callerAuth.test.ts`, `tests/renderer/lib/launchSecret.test.ts`, `tests/renderer/components/terminal/TerminalPane.test.tsx`

**Problem:** Any web page the user opens can drive the local API. CORS accepts `Origin: null` (a sandboxed iframe) and every `localhost` / `127.0.0.1` origin, and with lock off `POST /api/auth/unlock` returns a JWT without a password. A page can therefore read a token and use the whole API, including `POST /api/profiles/:id/connect` and the terminal WebSocket, whose upgrade checks no `Origin` at all. Nothing checks the `Host` header either, so a page on an attacker's domain that re-binds its DNS to `127.0.0.1` is same-origin and needs no CORS (DNS rebinding).

**Main-process work:**

- Generate a per-launch secret (`crypto.randomBytes(32)`, memory only). Pass it to the backend as `LAUNCH_SECRET` (the same value across BL-16 restarts) and to the renderer through the preload as `window.api.launchSecret` (`get-launch-secret` — in `src/preload/index.ts` **and** `src/preload/index.d.ts`).
- Set `ALLOWED_CORS_ORIGINS` to the origin of `ELECTRON_RENDERER_URL` only when the renderer is loaded from the electron-vite dev server; in every other case it is cleared, so a value inherited from the user's environment never reaches a packaged backend.

**Backend work:**

- Every `/api/auth/*` request must carry `X-CypherShell-Launch: <secret>` (constant-time comparison), otherwise `403`. Without a configured `LAUNCH_SECRET` every auth request is refused.
- Origin allowlist: `file://` (the packaged renderer's WebSocket origin) plus the exact entries of `ALLOWED_CORS_ORIGINS` — no wildcard. A request whose `Origin` is anything else, `null` included, gets `403` before any route runs. Requests without `Origin` (the packaged renderer, same-origin `GET`s, non-browser clients) go on to the other checks.
- `Host` check against DNS rebinding: a request whose `Host` is not `127.0.0.1`, `localhost` or `[::1]` (any port) gets `403`.
- The terminal WebSocket upgrade applies the same Host and Origin checks and requires the secret as the `launch` query parameter.

**Frontend work:** `lib/api.ts` sends the header on every request; `TerminalPane` adds `launch` to the WebSocket URL.

**Acceptance Criteria:**

- [x] `/api/auth/*` without the launch secret, or with a wrong one, returns 403 — a lock-off unlock no longer hands out a token
- [x] `Origin: null`, `Origin: http://localhost:8080` and any other origin outside the allowlist get 403 and no `Access-Control-Allow-Origin`; `file://` and `ALLOWED_CORS_ORIGINS` entries are accepted
- [x] A request with `Host: attacker.example:4000` gets 403
- [x] A WebSocket upgrade with a foreign Origin or Host, or without the launch secret, is refused before a shell opens

---

### ~~BL-18 — Lock Enforcement~~ ✅ Implemented

**Requirements:** FR-07.5, NFR-02 (token revocation on every transport)
**Priority:** Critical
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/lockEnforcement.test.ts`, `tests/backend/idleLock.test.ts`, `tests/renderer/App.test.tsx`, `tests/renderer/components/terminal/TerminalPane.test.tsx`

**Problems:**

1. The terminal WebSocket upgrade only calls `jwt.verify`, so a token revoked by locking still opens terminals.
2. `POST /api/auth/lock` leaves open terminal sockets and SFTP progress streams running, and the terminal and SFTP windows stay open: a locked app keeps live shells.
3. Each window runs its own idle timer (`App.tsx`). Typing in a terminal window is not activity for the main window, so the app locks while it is in use, and an idle connection window locks it too.

**Backend work:**

- The upgrade verifies the token with the same `verifyToken` as REST and SSE (signature, expiry, `jti` in `TokenStore`).
- New `AppLockService.lock()` clears the active key, revokes every token, closes every terminal socket (close code `4001`, "App locked") and ends every SFTP progress stream. `POST /api/auth/lock` goes through it. Running tunnels and in-flight transfers are left running.
- The backend is spawned with a Node IPC channel to main (and `CYPHERSHELL_HOST_IPC=1`; without it the bridge is off). It reports the auto-lock policy `{ type: 'lock-policy', enabled, autoLockMinutes }` at startup and after every change (setup, skip, setting or removing the master password, `PUT /api/config`), reports `{ type: 'locked' }` after each lock, and locks when main sends `{ type: 'lock' }`. When the channel closes — main is gone — the backend exits instead of lingering with the key in memory.

**Main-process work:**

- New `src/main/idleLock.ts` (no Electron imports, unit-tested): one idle clock for the whole app. Every window's `input-event` (keys, mouse, wheel) resets it; when lock is enabled and no input arrives for `autoLockMinutes`, main asks the backend to lock.
- On `locked`, main closes every terminal and SFTP window and sends `app:locked` to the main window (`onAppLocked(cb)` in both preload files).

**Frontend work:** Remove the per-window idle timer from `App.tsx`. On `app:locked` the main window drops its token and shows the lock screen. A terminal socket closed with code 4001 is not reconnected.

**Acceptance Criteria:**

- [x] A token revoked by locking cannot open a terminal WebSocket
- [x] Locking closes every open terminal socket and SFTP progress stream
- [x] Input in any window postpones auto-lock; with no input anywhere the app locks once after `autoLockMinutes`, and never while lock is off
- [x] After a lock, main closes the connection windows and the main window shows the lock screen

---

### ~~BL-19 — Token & Secret Hygiene~~ ✅ Implemented

**Requirements:** NFR-02, §10.3
**Priority:** High
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/tokenHygiene.test.ts`, `tests/backend/secretFiles.test.ts` (the POSIX permission cases run on Linux CI; Windows skips them)

**Problems:**

1. `verifyToken` skips the revocation check for a token without `jti`, so such a token can never be revoked.
2. The JWT signing secret lives in `{userData}/secrets/jwt-secret` and is reused across launches. That file and the storage-key fallback (plaintext when `safeStorage` is unavailable) are written with the default `0644` permissions in a `0755` directory, so other local users can read them on Linux and macOS.

**Backend work:** The backend creates its JWT signing secret in memory at startup (`crypto.randomBytes(48)`); it is never read from disk or from the environment. `verifyToken` accepts only `HS256` and requires a `jti` that is in `TokenStore`.

**Main-process work:** Main no longer creates or passes a JWT secret, and deletes a `jwt-secret` file left by an older version. `secrets/` is created with mode `0700` and `storage-key` written with mode `0600`; on POSIX, existing ones are re-permissioned at startup. New `src/main/secretFiles.ts` (no Electron imports, unit-tested).

**Acceptance Criteria:**

- [x] A correctly signed token without `jti` is rejected on REST, SSE and the WebSocket
- [x] A token signed with another secret — including the old `JWT_SECRET` environment value — or another algorithm is rejected
- [x] On POSIX, `secrets/` is `0700` and `storage-key` `0600`, also when they existed with wider permissions; a legacy `jwt-secret` file is removed

---

### ~~BL-20 — Connection Window Token Hand-off~~ ✅ Implemented

**Requirements:** FR-02.9, §10.7
**Priority:** High
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/connectionTokens.test.ts`, `tests/renderer/App.test.tsx`

**Problem:** Production builds append `&token=<JWT>` to every terminal and SFTP window URL, and `App.tsx` still reads a token from the URL as a fallback. The one-time hand-off is keyed by session id, so two windows opened for one session within 30 s compete for a single token.

**Main-process work:** Connection window URLs carry only the route and `profileId`. The pending token is keyed by the new window's `webContents.id`; `get-connection-token` hands it out once, only to that window, within 30 s. New `src/main/connectionTokens.ts` (no Electron imports, unit-tested).

**Frontend work:** `App.tsx` drops the URL-token fallback; `getConnectionToken()` takes no argument.

**Acceptance Criteria:**

- [x] No connection window URL contains a token
- [x] A token reaches only the window it was issued for, once; another window, a second claim or a claim after 30 s gets `null`
- [x] `App.tsx` ignores a token in the URL hash

---

### ~~BL-21 — Electron Window Hardening~~ ✅ Implemented

**Requirements:** §10.7, NFR-02
**Priority:** High
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/windowSecurity.test.ts`, `tests/renderer/lib/launchSecret.test.ts`, `tests/renderer/components/terminal/TerminalPane.test.tsx`

**Problems:** Only the main window has a `setWindowOpenHandler`. In terminal windows xterm's `WebLinksAddon` calls `window.open`, which opens the link in a new Electron window that inherits the preload — any page linked from terminal output would get `window.api`. No window blocks navigation, and no IPC handler checks which frame sent the message.

**Main-process work:**

- `app.on('web-contents-created')` gives every `webContents` a window-open handler that always denies — `http:` and `https:` URLs go to `shell.openExternal`, other schemes are dropped — and a `will-navigate` handler that blocks every URL outside the app's renderer (the dev-server origin, or the packaged `index.html`).
- Every IPC handler first checks `event.senderFrame`: only a top-level frame showing the app's renderer is served.
- New `src/main/windowSecurity.ts` (no Electron imports, unit-tested) holds these URL decisions.

**Frontend work:** `TerminalPane` gives xterm's `WebLinksAddon` a handler that passes the link URL to `window.open` (new `lib/terminalSocket.ts`). The addon's default opens a blank window first and navigates it afterwards, which the window-open handler now refuses — terminal links would otherwise stop working.

**Acceptance Criteria:**

- [x] Every window denies `window.open`; http(s) links open in the system browser and other schemes are dropped
- [x] Navigation away from the app's renderer is blocked in every window
- [x] IPC from a subframe or from a page outside the app is refused

---

### ~~BL-22 — Dialog-Bound File IPC~~ ✅ Implemented

**Requirements:** FR-05.9, FR-09.1, FR-09.4, FR-10.1, FR-10.4
**Priority:** High
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/textFiles.test.ts`, `tests/renderer/dialogBoundFiles.test.tsx`

**Problem:** `fs:executeOp` gives the renderer generic `readFile` and `writeFile` for any path under the home directory, so any script in a renderer can read `~/.ssh/id_rsa` or rewrite a shell profile. Its `mkdir`, `rename` and `delete` operations have no callers. The preload also exposes `window.electron` (the `@electron-toolkit/preload` bridge), a generic `ipcRenderer` passthrough to every channel; its only user is the unused `Versions.tsx` scaffold. Two event subscriptions (`onUpdateDownloaded`, `onBackendRestarted`) hand the page the raw `IpcRendererEvent`, whose `sender` is `ipcRenderer` itself. Exports and imports outside the home directory fail with "Access denied".

**Main-process work:**

- Remove `fs:executeOp`, `dialog:openJsonFile`, `dialog:openCskbFile`, the `window.electron` bridge and the unused `Versions.tsx`. Every preload subscription calls the page's callback with data only, never the event.
- New `dialog:saveTextFile({ kind, defaultName, content })`: main shows the save dialog — the suggested name is reduced to a bare file name, so the page cannot point the dialog at a folder — and writes the content (at most 5 MB) to the chosen file. Returns the path, or `null` when cancelled.
- New `dialog:openTextFile({ kind })`: main shows the open dialog and returns `{ name, content }` (UTF-8, at most 5 MB, so anything saved can be opened again), or `null`.
- `kind` (`json`, `cskb`, `pub`) only selects the dialog's file-type filter; the renderer never supplies a path. New `src/main/textFiles.ts` (dialogs injected, unit-tested).

**Frontend work:** Profile export and import (`Home.tsx`), public-key export (`Keys.tsx`) and `.cskb` export and import (`ExportKeyBundleDialog.tsx`, `ImportKeyBundleDialog.tsx`) use the new calls.

**Acceptance Criteria:**

- [x] The preload exposes no call that reads or writes a renderer-supplied path, and no generic IPC passthrough
- [x] Saving writes exactly the content to the chosen file, including outside the home directory; cancelling writes nothing
- [x] Opening returns the chosen file's name and content; a file over 5 MB is refused
- [x] The five callers export and import through the new calls

---

### ~~BL-23 — Request Validation for SFTP, Tunnels and Config~~ ✅ Implemented

**Requirements:** NFR-02 (zod validation; local paths), §10.6, FR-04.10, FR-04.16, FR-06.1–FR-06.3
**Priority:** High
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/requestValidation.test.ts`, `tests/renderer/components/profiles/ProfileDetailPane.test.tsx`

**Problems:**

1. SFTP, tunnel and config request bodies reach the services unvalidated.
2. `transferId` is used raw as an `EventEmitter` event name. With `"error"`, the first progress event throws inside an ssh2 callback and the backend exits; `"newListener"` and similar names corrupt the emitter.
3. (Superseded in part by BL-47: the request no longer carries a local path.) The SFTP `localPath` goes straight to `fastPut` / `fastGet`: a relative path resolves against the backend's working directory, and a directory, device or pipe is opened as if it were a file.
4. The Profile Details tab stops a dynamic tunnel by sending its (empty) remote port, so the tunnel keeps running.

**Backend work:** zod schemas in the SFTP, tunnel and config controllers; a failure returns `400 { error }`.

- `transferId` must match `^(up|dn)-[0-9a-z]{1,32}$` — `up-` for uploads, `dn-` for downloads — on upload, download, progress and cancel. Starting a transfer whose id is already in progress returns `409`.
- Local paths (new `LocalPathService`): absolute, without NUL bytes, normalized. An upload source must be an existing regular file; a download target's directory must exist and the target must not be a directory. Any folder the native dialogs can pick stays allowed, so there is no base-directory restriction.
- Remote paths: non-empty, at most 4096 characters, no NUL. The `chmod` mode: 3–4 octal digits, or an integer up to `0o7777`.
- Tunnels: `type` ∈ `local | remote | dynamic`; ports are integers 1–65535 (digit strings accepted — the UI sends strings); `remoteHost` is required for local forwards. Stop takes `{ type, port }`.
- Config: `theme` ∈ `dark | light | system`, `defaultFont` 1–200 characters, `defaultFontSize` 8–72, `logRetentionDays` 0–3650, `autoLockMinutes` 1–1440. Other keys (such as `lockEnabled`) are still ignored.

**Frontend work:** Stopping a dynamic tunnel sends its local port (§9.8).

**Acceptance Criteria:**

- [x] `transferId: "error"` and every other id outside the format get 400 on all four endpoints, and the backend keeps running
- [x] An upload from a relative path, a missing file or a directory gets 400, as does a download into a missing directory
- [x] Invalid tunnel and config bodies get 400, while the payloads the UI sends still succeed
- [x] A dynamic tunnel stopped from the UI stops

---

### ~~BL-24 — macOS Update Notice~~ ✅ Implemented

**Requirements:** NFR-07, ADR-004
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/updatePolicy.test.ts`, `tests/renderer/components/layout/UpdateBanner.test.tsx`

**Problem:** macOS builds are unsigned (ADR-004), and Squirrel.Mac only installs an update signed like the running app. electron-updater still downloads every new version on macOS, and the download never installs.

**Main-process work:** On `darwin`, `autoDownload` and `autoInstallOnAppQuit` are off and `updater:install` does nothing. `update:available` carries `{ version, manual }`, with `manual: true` on darwin. New `updater:openDownloadPage` opens the GitHub Releases page (`https://github.com/athul-ts/CypherShell/releases/latest`, fixed in main). New `src/main/updatePolicy.ts` (pure, unit-tested).

**Frontend work:** `UpdateBanner` shows "CypherShell <version> is available" with a "Download from GitHub Releases" button when the update is manual.

**Acceptance Criteria:**

- [x] On darwin the updater never downloads or installs; Windows and Linux keep downloading and installing
- [x] The banner offers the Releases download for a manual update and "Restart & Install" otherwise
- [x] The policy and the banner are covered by unit tests that run in CI on any platform
- ⚠️ Not verified on a real Mac (none available): that `checkForUpdates()` on an unsigned build announces the update without attempting a Squirrel.Mac install

---

### ~~BL-25 — Single App Instance~~ ✅ Implemented

**Requirement:** NFR-03
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/singleInstance.test.ts`

**Problem:** Starting CypherShell while it runs launches a second app with a second backend on the same database and secrets. The two have separate lock states, token stores and SSH sessions, and the second truncates the first's `app.log`.

**Main-process work:** `app.requestSingleInstanceLock()` runs before anything else; a second instance quits at once, before writing the log or spawning a backend. On `second-instance` the running app restores (if minimized) and focuses its main window, recreating it if it was closed.

**Acceptance Criteria:**

- [x] A second launch exits without starting a backend, and the running app's main window comes to the front (unit test of the focus logic; the exit verified by a two-launch run of the built app on Windows)

---

### ~~BL-26 — Master Password Policy~~ ✅ Implemented

**Requirements:** FR-07.1, FR-07.7, NFR-02
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/backend/masterPassword.test.ts`, `tests/renderer/masterPasswordPolicy.test.tsx`

**Problem:** A master password needs only 6 characters, though it is the only protection of every stored secret against offline guessing on a copied database, and the user gets no feedback on its strength.

**Backend work:** `POST /api/auth/setup` and a new password set through `POST /api/auth/setup-password` require at least 10 characters. Unlocking, `disable-lock` and re-enabling lock with an existing master password accept any length, so older, shorter passwords keep working.

**Frontend work:** New `lib/passwordStrength.ts`. `SetupWizard` and the Settings set-password dialog require 10 characters and show a strength hint (weak / fair / strong, from length and character variety) as the user types.

**Acceptance Criteria:**

- [x] A 9-character password is rejected by setup and when setting a new master password; 10 characters are accepted
- [x] An existing shorter master password still unlocks and re-enables lock
- [x] The wizard and the Settings dialog block passwords under 10 characters and show the hint

---

### ~~BL-27 — E2E Tests Use a Throwaway Profile~~ ✅ Implemented

**Requirement:** NFR-06
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/e2e/app.spec.ts`

**Problem:** `tests/e2e/app.spec.ts` launches `out/main/index.js` with `DATABASE_URL` and `JWT_SECRET` set, but main ignores both: it points the backend at `{userData}/sshclient.db` and passes its own JWT secret. The suite therefore runs on the user's real profile, `%APPDATA%\cyphershell` (on Windows, case-insensitively the installed app's `%APPDATA%\CypherShell`). Each run truncates its `app.log`, applies the build's migrations to its database, creates missing secrets and writes Chromium state there. A run while the app is open shares the profile with it; since BL-25 it exits at once and the suite fails.

**Test work:** Each test creates a temp profile (`fs.mkdtempSync(path.join(os.tmpdir(), 'cs-e2e-'))`) and launches the app with `--user-data-dir=<dir>`, which Electron uses as `app.getPath('userData')`. It asserts that the app's `userData` is that directory and that `app.log` and `sshclient.db` are created in it, and deletes the directory after the app has closed. The ignored `DATABASE_URL` / `JWT_SECRET` entries are removed. No app code changes.

**Acceptance Criteria:**

- [x] `npm run build:e2e && npm run test:e2e` passes on Windows and creates or changes nothing in `%APPDATA%\cyphershell` (names, sizes and timestamps of every entry compared before and after the run)
- [x] Each test's `userData`, `app.log` and database are in its own temp profile, which is deleted afterwards (asserted by the tests; a launch on a different directory fails them)
- ⚠️ Not run on macOS or Linux: the e2e suite is not part of CI

---

### ~~BL-28 — Audit Log CSV Export~~ ✅ Implemented

**Requirement:** FR-08.6
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-11 — regression tests: `tests/renderer/pages/Logs.test.tsx`, `tests/backend/textFiles.test.ts`, `tests/backend/auditExport.test.ts`

**Problem:** The Logs page's Export CSV button sets `window.location.href` to `http://127.0.0.1:<port>/api/audit/export`. A navigation carries neither the JWT nor the launch secret, so the backend would answer `401`; since BL-21 the main process blocks that navigation, so the button does nothing. The CSV is also malformed for some entries: `AuditService.exportCSV` wraps Profile, Host and Error in quotes without doubling the quotes inside them (only Detail is escaped), so a `"` in any of them breaks its row.

**Main-process work:** `TEXT_FILE_FILTERS` (`src/main/textFiles.ts`) gains a `csv` kind (filter "CSV Files", `.csv`). The kind check is derived from that table, so a kind cannot be added to the filters without being accepted. The preload types (`src/preload/index.ts`, `src/preload/index.d.ts`) gain `'csv'`.

**Backend work:** `exportCSV` quotes every text field (Profile, Host, Detail, Error) and doubles the `"` inside it (RFC 4180). The route, its JWT requirement and the columns are unchanged.

**Frontend work:** `Logs.tsx` fetches the CSV through the Axios client, `api.get('/audit/export', { responseType: 'text' })`, so the JWT and launch secret are sent. It saves the text with `window.api.saveTextFile({ kind: 'csv', defaultName: 'cyphershell-audit-<YYYY-MM-DD>.csv', content })`, using the local date. A save shows a success toast and a cancel shows nothing; a failed request or save shows an error toast with the reason. The button is disabled while an export runs. An export over 5 MB (the BL-22 limit) is refused with that reason; larger exports are tracked, not scheduled.

**Acceptance Criteria:**

- [x] Export CSV fetches `/audit/export` through the API client and passes the CSV text unchanged to `saveTextFile`, with kind `csv` and the dated name; the window never navigates
- [x] A save shows a success toast, a cancel shows none, and a failed request or save shows an error toast
- [x] `saveTextFile` accepts the `csv` kind, offers the CSV filter and writes the content
- [x] `GET /api/audit/export` still requires the session token, and a `"`, `,` or line break in a profile name, host, detail or error survives a CSV parser
- [x] In the built app on Windows (throwaway profile, only the native dialog stubbed), Export CSV saved the CSV to the chosen file, with a profile name containing `"` and `,` intact

---

### Phase 3 — Remaining Functional Gaps (BL-29 … BL-35)

Specified 2026-11-18 from the ⚠️ "tracked, not scheduled" notes in §6. Each item is implemented with regression tests, and its requirement badges are updated when it lands.

---

### ~~BL-29 — Terminal Resize & Reconnect~~ ✅ Implemented

**Requirements:** FR-02.3, FR-02.6, FR-02.7
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-18 — regression tests: `tests/backend/sessions.test.ts`, `tests/renderer/components/terminal/TerminalPane.test.tsx`

**Problem:** The renderer sends the first `resize` as soon as the socket opens, but the backend registers its message handler only after the remote shell has started, so that resize is dropped and a new terminal stays 80×24 until the window is resized. A normal `exit` closes the socket with code 1000 and the renderer then "reconnects" to a fresh shell. A socket closed because the session no longer exists (1008) is also retried. The badge has no "reconnecting" state.

**Backend work:** `terminal.ws.ts` registers its message handler as soon as the socket is accepted. It keeps the latest `resize` and any early `input` until the shell is ready, then applies the size and flushes the input in order.

**Frontend work:** `TerminalPane.tsx` does not reconnect after close code 1000 (shell ended), 1008 (session gone) or 4001 (locked). Any other unexpected close reconnects as before. While a reconnect is pending or in progress the badge shows "Reconnecting". Re-creating a dropped SSH session from its profile is not part of this item (tracked, not scheduled).

**Acceptance Criteria:**

- [x] A `resize` sent right after connecting is applied to the remote PTY
- [x] Input sent before the shell is ready reaches the shell, in order
- [x] Close codes 1000, 1008 and 4001 never trigger a reconnect; an abnormal close does, with the 1 s → 2 s → 4 s backoff
- [x] The badge shows "Reconnecting" between attempts

---

### ~~BL-30 — SFTP Transfers & Paths~~ ✅ Implemented

**Requirements:** FR-04.4, FR-04.7, FR-04.13, FR-04.15
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-18 — regression tests: `tests/backend/sftpTransfers.test.ts`, `tests/renderer/components/sftp/SftpPane.test.tsx`, `tests/renderer/lib/sftpPaths.test.ts`

**Problems:** Dragging files in from the OS reads `File.path`, which Electron removed in v32, so the drop uploads nothing. A failed transfer has no Retry action. Deleting a folder calls `unlink` and fails. An upload over an existing remote file fails at the final rename. Remote paths stay relative to the login directory, so `/etc` or `/var/www` cannot be reached.

**Main/preload work:** `window.api.getPathForFile(file)` wraps `webUtils.getPathForFile` (both `src/preload/index.ts` and `index.d.ts`). (Superseded by BL-47: the preload turns a dropped file into a grant and the path never reaches the page.)

**Backend work:** `SftpService.deleteFile` stats the target and uses `rmdir` for a directory (non-empty directories fail with the server's message; recursive delete is out of scope). Upload finishes with the OpenSSH `posix-rename@openssh.com` extension, which replaces an existing file, and falls back to unlink-then-rename on servers without it. New `GET /api/sftp/:sessionId/realpath?path=.` returns the absolute path.

**Frontend work:** `SftpPane.tsx` resolves the starting directory through `realpath` and keeps absolute paths, so the breadcrumb reaches `/`. Dropped files use `getPathForFile`. A failed transfer shows a Retry button that starts the same transfer again.

**Acceptance Criteria:**

- [x] A file dropped from the OS uploads, using the path from `getPathForFile`
- [x] A failed transfer shows its error and a Retry that starts a new transfer with the same source and target
- [x] Deleting an empty folder succeeds; deleting a non-empty one reports the server's error
- [x] Uploading over an existing remote file replaces it; a failure still emits an `error` event
- [x] The pane opens at the absolute home path, and the breadcrumb navigates up to `/`

---

### ~~BL-31 — Profile Details: Last Connected, Validation, Port Errors~~ ✅ Implemented

**Requirements:** FR-01.2, FR-01.8.7, FR-06.6
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-18 — regression tests: `tests/backend/profileConnect.test.ts`, `tests/backend/tunnelStability.test.ts`, `tests/renderer/components/profiles/ProfileForm.test.tsx`, `tests/renderer/components/profiles/ProfileDetailPane.test.tsx`, `tests/renderer/pages/Home.test.tsx`

**Problems:** `lastConnectedAt` is never written and never shown. The profile form relies on HTML `required` and shows no field errors. A busy tunnel port shows a generic "Failed to start tunnel".

**Backend work:** `connectProfile` sets `lastConnectedAt` after a successful connection. Starting a tunnel on a busy port answers `409 { code: 'PORT_IN_USE', port, error }`.

**Frontend work:** Home cards show "Last connected <relative time>" or "Never connected". `ProfileForm` validates Name, Host, Username (required) and Port (1–65535) on submit, shows a message under each invalid field and does not call the API. The tunnel panel shows "Port N is already in use" for `PORT_IN_USE`.

**Acceptance Criteria:**

- [x] A successful connect updates `lastConnectedAt`; a failed one does not
- [x] Cards show the last-connected time or "Never connected"
- [x] Blank Name/Host/Username and an out-of-range Port show inline errors and send nothing
- [x] A busy port yields `409 PORT_IN_USE` and the UI names the port

---

### ~~BL-32 — Audit Log: Reasons, Paging, Filters, CSV Safety~~ ✅ Implemented

**Requirements:** FR-08.2, FR-08.5, BL-05, FR-08.6
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-18 — regression tests: `tests/backend/auditLog.test.ts`, `tests/backend/auditExport.test.ts`, `tests/renderer/pages/LogsPaging.test.tsx`

**Problems:** The disconnect reason is always "Connection closed", and an error after connecting writes a "connection failed" entry plus two disconnect entries. The log loads only the newest 100 entries and filters them in the browser. The type filter lacks "disconnection". CSV cells that start with `=`, `+`, `-` or `@` run as formulas in spreadsheet programs, and error text can come from a remote server.

**Backend work:** `SSHService` writes exactly one disconnect entry per session with a reason: `user` (closed through `DELETE /api/sessions/:id`), `timeout` (idle reaper), `error` (SSH error, with its message) or `closed`. `GET /api/audit?page=&pageSize=&type=&from=&to=&q=` filters and pages on the server and answers `{ items, total, page, pageSize }`. `exportCSV` prefixes a cell that starts with `=`, `+`, `-`, `@`, tab or CR with a single quote.

**Frontend work:** `Logs.tsx` sends the filters to the API, shows a pager, and adds the "Disconnection" type.

**Acceptance Criteria:**

- [x] One disconnect entry per session; its detail names the reason (user, timeout, error, closed)
- [x] Pagination, type, date and search filters are applied by the API; `total` is the filtered count
- [x] The Logs page can select "Disconnection" and page through results
- [x] A cell beginning with `=`, `+`, `-` or `@` is exported with a leading single quote; values still round-trip through a CSV parser

---

### ~~BL-33 — Key Bundle Import: Overwrite in Place~~ ✅ Implemented

**Requirements:** FR-10.6
**Priority:** Low
**Status:** ✅ Implemented 2026-11-18 — regression tests: `tests/backend/keyOverwrite.test.ts`

**Problem:** Importing a `.cskb` with the Overwrite resolution deletes the existing key and then creates a new one, which unlinks every profile that used it and is not transactional.

**Backend work:** `applyKeyImport` with `overwrite` updates the existing key row in place, so its id and its profile links survive. A failure leaves the old key untouched.

**Acceptance Criteria:**

- [x] After Overwrite, the key keeps its id and every profile still references it
- [x] A failure while overwriting leaves the old key untouched

---

### ~~BL-34 — Saved Tunnel Rules~~ ✅ Implemented

**Requirements:** FR-06.4, FR-09.2
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-18 — regression tests: `tests/backend/tunnelRules.test.ts`, `tests/renderer/components/profiles/ProfileDetailPane.test.tsx`

**Problem:** Tunnels exist only while running. The `Tunnel` table is touched only by profile import/export, so exports never contain rules. `TunnelModal.tsx` is dead code.

**Backend work:** `GET/POST/DELETE /api/profiles/:id/tunnels` list, save and delete rules (type, local port, remote host/port, optional label), validated with zod. Remove `TunnelModal.tsx`.

**Frontend work:** The tunnel panel in `ProfileDetailPane` lists saved rules with Start and Delete, and offers "Save rule" next to Start Forwarding.

**Acceptance Criteria:**

- [x] A saved rule persists and appears in the profile's export
- [x] A saved rule can be started and deleted; invalid ports are rejected with 400
- [x] `TunnelModal.tsx` no longer exists

---

### ~~BL-35 — Light Theme & Bundled Terminal Font~~ ✅ Implemented

**Requirements:** §11.2, §11.3, FR-02.10
**Priority:** Low
**Status:** ✅ Implemented 2026-11-18 — regression tests: `tests/renderer/lightTheme.test.ts`, `tests/renderer/bundledFont.test.ts`, `tests/renderer/hooks/useAppTheme.test.tsx`, `tests/renderer/store/terminalThemeStore.test.ts`, `tests/renderer/components/terminal/TerminalPane.test.tsx`

**Problems:** Choosing "Light" toggles a class that no CSS styles. JetBrains Mono is named but not shipped, so terminals fall back to system fonts. Theme and font changes reach only terminals opened afterwards, and the app theme was read from the saved config once at start-up, so choosing it in Settings changed nothing until the next launch.

**Frontend work:** Light-mode styles for the app's dark surfaces; JetBrains Mono bundled as a local asset with `@font-face` (CSP `font-src 'self'`). An open terminal updates when its theme or font changes, in every window. The app theme comes from the shared config query, so saving it in Settings applies it at once.

**Acceptance Criteria:**

- [x] Selecting Light changes the app background and text; System follows `prefers-color-scheme`
- [x] The terminal font loads from the bundled asset with no network request
- [x] Changing the terminal theme or font in Settings updates an open terminal

---

### Phases 4–5 — Security, Reliability and Quality (BL-36 … BL-46)

Specified 2026-11-20. Phase 4 adds the missing capabilities (FR-11, FR-07.8, keyboard-interactive login, SSH reconnect); Phase 5 covers dependencies, CI, code structure, logging and measurement. BL-36 and BL-37 come first so every later change is tested on the shipped runtime and enforced by CI. Each item is implemented with regression tests, and its badges are updated when it lands. BL-46 does not start until ADR-005 is accepted.

---

### ~~BL-36 — Dependency Security Update (Electron 45)~~ ✅ Implemented

**Requirements:** NFR-02, NFR-07, ADR-003
**Priority:** High
**Status:** ✅ Implemented 2026-11-20 — regression tests: `tests/backend/nativePrebuild.test.ts`, `tests/backend/secretFiles.test.ts`; verified by the Windows package, a packaged-app smoke run on a throwaway profile, and `npm audit`

**Problem:** `npm audit` (2026-11-20) reports 18 vulnerabilities in the backend's production dependencies (critical: `proxy-addr` via express; high: `ws`, `zod`, `body-parser`, the Prisma tooling chain, and the unused `multer` and `node-forge`) and 48 at the root (critical: `tar` via `@electron/rebuild` 3; high: `electron`, `axios`, `electron-updater`, `react-router`, `zod`, `vite`, `postcss`). Electron 39 is out of support, and fixes exist only in Electron 42.11.16 and later.

**Work:**

- Root: `electron` ^45.4.1, `electron-builder` latest 26.x, `@playwright/test` ^1.65, `@types/node` ^24; `npm audit fix` (never `--force`) for `axios`, `electron-updater`, `react-router-dom`, `zod`, `vite`, `postcss`; remove the unused `react-dropzone`, and `@electron/rebuild` (nothing is rebuilt any more — see below). Keep `electron-vite` 5.
- Backend: latest `express` 5.x, `ws` 8.x, `zod` 4.x and `prisma` / `@prisma/*` 7.x (`npx prisma generate` afterwards); remove the unused `multer`, `@types/multer`, `node-forge`, `portfinder`, `nodemon`, `ts-node` and the unused `dev` script; `@types/node` ^24 and `typescript` ~5.9.3 so the repository has one TypeScript version; `build.cjs` targets `node24`.
- Native module (ADR-003): `better-sqlite3` ^13.2.0. Version 12 does not compile against Electron 45's V8; 13 is built on N-API and ships prebuilt binaries for Windows, macOS and Linux (x64 and arm64) inside the npm package, so one binary runs under system Node (tests, development) and under Electron. The Prisma adapter's `^12.6.0` range is overridden (`"overrides": { "better-sqlite3": "$better-sqlite3" }`). The Electron-ABI rebuild is removed: no `rebuild:native` or `predev` script and no `scripts/rebuild-native.cjs`. `scripts/after-pack.cjs` keeps only the target's prebuild, deletes any locally compiled `build/` directory (the loader prefers it over the prebuild, and it would be built for the packaging machine), and checks the kept binary's architecture from its PE, ELF or Mach-O header. The SQLite sources (`deps/`, `src/`, `binding.gyp`) and the now unused `bindings` / `file-uri-to-path` copies are no longer packaged. The Linux prebuild needs glibc 2.34, so the Linux minimum becomes Ubuntu 22.04.
- Electron 45: `postinstall` becomes `install-electron` (Electron 42 stopped downloading the binary on `npm install`; the root has no native dependencies, so `electron-builder install-app-deps` is dropped). `safeStorage` moves to `isAsyncEncryptionAvailable` / `encryptStringAsync` / `decryptStringAsync` (the synchronous API is removed in Electron 46); the `secretFiles.ts` codec becomes asynchronous and its caller awaits it before the backend starts. Key files written by the old API must still load. The built preload must not use `Buffer`, `setImmediate` or `require('events')` (removed from sandboxed preloads in Electron 45).
- `CLAUDE.md`, §2.3 and the technology table name Electron 45, the Node 24 runtime and TypeScript 5.9.

**Acceptance Criteria:**

- [x] Backend `npm audit --omit=dev` reports no high or critical advisory
- [x] Root `npm audit` reports no critical advisory, and none in `electron`, `axios`, `electron-updater`, `react-router` or `zod`
- [x] Typecheck, lint, all backend and renderer tests and the e2e suite pass
- [x] `npm run build:win` succeeds and the unpacked app starts on a throwaway profile; terminal, SFTP and the light theme work
- [x] An existing storage-key file written with the synchronous `safeStorage` API is still read
- [x] Backend tests, development and the packaged app use the same `better-sqlite3` binary with no rebuild step; the packaged app contains only the target platform's prebuild and no `build/` directory
- [x] Packaging fails when the kept prebuild's header names another architecture (unit-tested on the real prebuilds)

---

### ~~BL-37 — CI on Every Branch~~ ✅ Implemented

**Requirements:** NFR-06, NFR-07
**Priority:** High
**Status:** ✅ Implemented 2026-11-20 — regression tests: tests/backend/macUpdateFeed.test.ts, tests/e2e/app.spec.ts. The workflows are validated by parsing and the e2e test locally; their first run on GitHub (and the NFR-07 macOS feed answer) happens after the next push.

**Problem:** CI runs only on pull requests to `features`, on Node 20 (end of life); releases and PRs to `main` run no tests; the Electron suite (e2e) never runs in CI; there is no dependency scanning. The second e2e test passes without checking anything because it looks for a "Skip" button that the wizard does not have. Whether one `electron-builder --mac` run lists both macOS architectures in `latest-mac.yml` has never been verified (open question from NFR-07).

**Work:**

- `ci.yml`: runs on `push` to `ats`, on pull requests to `ats`, `features`, `dev`, `qa` and `main`, and as a reusable workflow; Node from a new `.nvmrc` (`24`). Jobs: **check** (typecheck, lint, `npm audit --omit=dev --audit-level=high` for the backend, `npm audit --audit-level=critical` at the root); **test** (backend and renderer tests on `ubuntu-latest` and `windows-2022`); **e2e** (`build:e2e` then `xvfb-run -a npm run test:e2e`, report uploaded on failure).
- `release.yml` calls `ci.yml` and the installer build waits for it; `build.yml` takes its Node version from `.nvmrc`.
- `scripts/check-mac-update-feed.cjs` fails the macOS build unless `latest-mac.yml` lists both `-macos-x64.zip` and `-macos-arm64.zip` with `sha512` and `size`. The first `package.yml` run answers the NFR-07 open question.
- `.github/dependabot.yml` (npm for `/` and `/backend`, `github-actions`; weekly, minor and patch updates grouped, target `ats`, Electron majors ignored) and `.github/workflows/codeql.yml` (`javascript-typescript`).
- `tests/e2e/app.spec.ts` test 2 always starts on a fresh profile, clicks "Continue without a password" and `#setup-skip-btn`, and asserts the Profiles page. `test-results/` is git-ignored.

**Acceptance Criteria:**

- [x] A pull request to `ats`, `features`, `dev`, `qa` or `main`, and a push to `ats`, runs check, test and e2e
- [x] A Release cannot start unless CI passed
- [x] The macOS feed check fails on a `latest-mac.yml` that lists only one architecture (unit-tested)
- [x] Dependabot and CodeQL are configured; every workflow file parses
- [x] The wizard e2e test fails if the wizard or the dashboard does not appear

---

### ~~BL-38 — SSH Host-Key Verification~~ ✅ Implemented

**Requirements:** FR-11.1 … FR-11.5, NFR-02
**Priority:** High
**Status:** ✅ Implemented 2026-11-20 — regression tests: tests/backend/hostKeys.test.ts, tests/renderer/components/profiles/HostKeyDialog.test.tsx, tests/renderer/components/profiles/ProfileHostKey.test.tsx, tests/renderer/components/settings/KnownHostsCard.test.tsx

**Problem:** the SSH client accepts any host key (no `hostVerifier`), so anyone on the network path can impersonate a server and capture its password.

**Decisions:** trust is bound to a live handshake — there is no endpoint that adds a key. After the user confirms a fingerprint the renderer repeats the connect with `acceptHostKey`; the backend stores the key only if the server presents exactly that fingerprint. A changed key is a hard stop that the dialog cannot override: the user removes the old entry in Settings and connects again (like `ssh-keygen -R`). One key is trusted per `host:port`; a key of another type is also a mismatch. Hosts are compared trimmed and lower-case. Existing installs are asked once per host.

**Backend work:**

- `KnownHost { id, host, port, keyType, fingerprint, publicKey, firstSeenAt, lastSeenAt }`, unique on `(host, port)`, new migration.
- `known-host.service.ts`: `fingerprintOf` (`SHA256:` + base64 without padding, as OpenSSH prints it), `keyTypeOf`, `check(host, port, blob, acceptFingerprint?)` → `trusted` (updates `lastSeenAt`) / `accepted` (stores the key) / `unknown` / `mismatch`, `list`, `remove`, and `HostKeyError`.
- `SSHService.createSession(profile, { acceptHostKey }?)` passes an asynchronous `hostVerifier` that calls `check`. A refused handshake rejects with `HostKeyError` (and no "connection failed" audit entry).
- `POST /api/profiles/:id/connect` accepts `{ acceptHostKey? }` (zod: `^SHA256:[A-Za-z0-9+/]{43}$`) and answers `409 { code: 'HOST_KEY_UNKNOWN' | 'HOST_KEY_MISMATCH', host, port, keyType, fingerprint, knownKeyType?, knownFingerprint?, error }`.
- `GET /api/known-hosts` (newest `lastSeenAt` first) and `DELETE /api/known-hosts/:id` (404 for an unknown id), behind `requireAuth`.
- Audit type `host_key`: "Unknown host key — confirmation requested", "Host key trusted", "Host key changed — connection blocked", "Known host removed". (The backend cannot observe a user declining, so FR-11.5 records what it can see.)

**Frontend work:** `HostKeyDialog.tsx` — for an unknown key it shows host:port, key type and fingerprint with a hint to compare it on the server (`ssh-keygen -lf /etc/ssh/ssh_host_<type>_key.pub`) and the buttons "Trust and connect" / "Cancel"; for a changed key it shows a red warning with both fingerprints, says that no password or key was sent, explains how to remove the old entry, and offers only "Close". `ProfileDetailPane` opens it on a 409 `HOST_KEY_*` instead of a generic toast. Settings gets a "Known Hosts" card (host:port, type, fingerprint, last seen, Remove with confirmation). Logs gets a "Host Key" filter.

**Acceptance Criteria:**

- [x] The first connect to a host returns 409 `HOST_KEY_UNKNOWN` with the key type and fingerprint, and the server sees no authentication attempt
- [x] Repeating the connect with the matching `acceptHostKey` connects and stores the key; a non-matching `acceptHostKey` stores nothing and is refused
- [x] A trusted host connects without a prompt and its `lastSeenAt` advances
- [x] A changed key returns 409 `HOST_KEY_MISMATCH` with both fingerprints, the server sees no authentication attempt, and `acceptHostKey` does not override it
- [x] Removing a known host makes the next connect prompt again; every decision is in the audit log
- [x] `fingerprintOf` matches the SHA-256 fingerprint `sshpk` computes for the same key
- [x] Integration tests against the in-process `ssh2.Server` cover accept, reconnect and mismatch

---

### ~~BL-39 — Change Master Password~~ ✅ Implemented

**Requirements:** FR-07.8
**Priority:** High
**Status:** ✅ Implemented 2026-11-22 — regression tests: tests/backend/changeMasterPassword.test.ts, tests/renderer/components/settings/ChangePasswordDialog.test.tsx

**Problem:** with app lock on there is no way to change the master password; the user would have to turn lock off and on again.

**Backend work:** `POST /api/auth/change-password` (`requireAuth`, rate-limited with the other password endpoints) takes `{ currentPassword, newPassword }` (new password at least 10 characters, different from the current one). It answers 400 when lock is off, 401 when the current password is wrong, then derives the new key from a new salt and calls `SecretsService.rekey` so every secret and the new hash and salt are stored in one transaction. The active key is replaced only after the transaction succeeds. It stays in `auth.controller.ts` (the master password is never used elsewhere) and reads the config through `ConfigService`.

**Frontend work:** Settings → Security shows "Change master password" while lock is on: a dialog with current, new and confirm fields, client-side checks (length, match, differs from current), the server's message shown inline, and the existing warning when secrets could not be re-encrypted.

**Acceptance Criteria:**

- [x] A wrong current password returns 401 and the old password still unlocks
- [x] After a change the old password no longer unlocks, the new one does, and profile passwords and private keys still decrypt
- [x] A failure while re-encrypting changes nothing (old password and key still work)
- [x] Too-short or unchanged new passwords return 400; the endpoint is rate-limited and requires a token

---

### ~~BL-40 — Keyboard-Interactive Login~~ ✅ Implemented

**Requirements:** FR-01.9
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-22 — regression tests: tests/backend/keyboardInteractive.test.ts

**Problem:** many servers (PAM setups, FreeBSD's default `sshd`) offer only `keyboard-interactive` authentication, so password profiles cannot log in to them.

**Backend work:** password profiles also set `tryKeyboard: true` and answer the server's challenge: no prompts → empty answer; exactly one hidden prompt → the stored password; anything else (one-time codes, several prompts) → no answer, and the failed connect is reported as "This server asked for an additional verification step (such as a one-time code), which CypherShell does not support yet." Key profiles never use it.

**Acceptance Criteria:**

- [x] A server that offers only keyboard-interactive accepts the stored password; a wrong password fails
- [x] A server that asks two prompts or a visible prompt fails with the message above
- [x] Key and key+passphrase profiles never attempt keyboard-interactive

---

### ~~BL-41 — Automatic SSH Reconnect~~ ✅ Implemented

**Requirements:** FR-02.6, NFR-03
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-22 — regression tests: tests/backend/autoReconnect.test.ts, tests/renderer/components/terminal/TerminalPane.test.tsx, tests/renderer/components/profiles/ProfileForm.test.tsx, tests/renderer/hooks/useSessionHeartbeat.test.tsx

**Problem:** when the SSH connection drops (server restart, network change) the session is removed, every terminal ends, and the user must reconnect and reopen everything by hand, although the profile has an `autoReconnect` setting.

**Backend work:**

- The backend re-creates the connection and keeps the **session id**. `SSHSession` gains `state: 'connected' | 'reconnecting'` and events `reconnecting`, `reconnected`, `lost`. The connect-config builder is shared with `createSession`.
- Trigger: the client closes for a reason other than `user` or `timeout`, and the profile's `autoReconnect` is on (read fresh). Attempts use the delays `[1000, 2000, 4000]` ms (`SSHService.RECONNECT_DELAYS_MS`, overridable in tests). Every attempt requires a trusted host key (BL-38): an unknown or changed key stops the attempts. Success swaps the client, re-attaches handlers, writes "Reconnected after connection loss" to the audit log. After three failures the session is removed with a "Reconnect failed" entry and `lost` is emitted. `removeSession` and a lock cancel pending attempts.
- Terminals keep their WebSocket while the session reconnects: `status: reconnecting`, input is dropped, then a new shell (last known size) is opened with `[Connection lost — reconnected]`. When the session is lost, or `autoReconnect` is off, terminals close with the new code **4002** (SSH connection lost).
- Tunnels: dynamic forwards read the current client for each connection; remote forwards are re-registered after a reconnect; connections that arrive while reconnecting are closed. SFTP channels reopen on demand; interrupted transfers fail and can be retried (BL-30).
- `GET /api/sessions/:id` returns `{ alive, state }`.

**Frontend work:** `shouldReconnect(4002)` is false and `TerminalPane` shows "Connection lost. Reconnect from the profile."; the badge shows "Reconnecting" for the new status; Profile Details shows "Reconnecting…"; `ProfileForm` gets a "Reconnect automatically" checkbox bound to `autoReconnect`.

**Acceptance Criteria:**

- [x] After the server drops the connection, an open terminal reports reconnecting, then works again on a new shell with the same session id
- [x] The audit log shows one disconnect entry and one "Reconnected" entry for it
- [x] With `autoReconnect` off, or after three failed attempts, terminals close with 4002 and the session is gone
- [x] A changed host key stops the reconnect without sending credentials
- [x] Local and dynamic tunnels work again after a reconnect; remote forwards are re-registered
- [x] A session closed during a reconnect makes no further attempts

---

### ~~BL-42 — Thin Controllers~~ ✅ Implemented

**Requirements:** NFR-06
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-22 — regression tests: tests/backend/layering.test.ts, the existing profile and auth suites

**Problem:** `profile.controller.ts` and `auth.controller.ts` call Prisma directly (8 calls each), against "business logic only in services".

**Work:** profile queries move to `ProfileService` (`list`, `get`, `create`, `update`, `remove`, `duplicate`, `findForConnect`); app-config reads and the first-run creation move to `ConfigService`. Password verification, key derivation and the `rekey` calls stay in `auth.controller.ts` (security rule). A test fails if any file in `backend/src/controllers` imports the database module or calls `prisma.`.

**Acceptance Criteria:**

- [x] No controller touches Prisma; behaviour and the existing tests are unchanged
- [x] The layering test passes and fails when a controller imports the database

---

### ~~BL-43 — Logging~~ ✅ Implemented

**Requirements:** NFR-06
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-22 — regression tests: tests/backend/logRotation.test.ts, tests/renderer/lib/log.test.ts, tests/e2e/app.spec.ts

**Problem:** `app.log` is overwritten at every start, so the log of a crashed run is lost; the log has no size limit; 26 `console.*` calls bypass the structured loggers; renderer errors never reach the log; stack traces point into bundled code.

**Work:**

- `src/main/log.ts` (no Electron imports): rotates `app.log` to `app.log.1` and `app.log.2` at start instead of truncating it, and again when it exceeds 5 MB. A second instance leaves the log alone.
- `console.*` is replaced by `log.ts` (main), `logger` (backend) and a renderer `reportError(context, err)` that sends errors over a new IPC channel `log:rendererError` (declared in both `src/preload/index.ts` and `index.d.ts`; main accepts only top-level app frames, caps a message at 2 KB and 20 per minute). ESLint `no-console` is an error, with exceptions for the logger files.
- Source maps: backend `sourcemap: 'linked'` and `--enable-source-maps`; main and preload built with source maps.

**Acceptance Criteria:**

- [x] Two consecutive starts keep the first run's log as `app.log.1`; a log over 5 MB rotates
- [x] `no-console` is enforced; the renderer's errors appear in `app.log`
- [x] The log IPC rejects other senders, oversized messages and floods (unit-tested)

---

### ~~BL-44 — Cleanup and Documentation~~ ✅ Implemented

**Requirements:** NFR-06
**Priority:** Low
**Status:** ✅ Implemented 2026-11-22 — regression tests: tests/renderer/noApiCasts.test.ts

**Work:** delete the unused `pages/Terminal.tsx`; remove the three `window.api as unknown as …` casts by typing the preload API (`index.d.ts`) for the window-opening calls and local directory entries; refresh `CLAUDE.md` (backlog status, drop the "unimplemented" sentence) and the §16 status table.

**Acceptance Criteria:**

- [x] No `as unknown as` casts of `window.api` remain; typecheck passes
- [x] `CLAUDE.md` and §16 describe the current state

---

### ~~BL-45 — Performance Checks~~ ✅ Implemented

**Requirements:** NFR-01
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-22 — regression tests: tests/backend/sshFixture.test.ts, tests/backend/perfSummary.test.ts, tests/perf/api.perf.ts, tests/e2e/perf.spec.ts

**Problem:** the NFR-01 targets have never been measured.

**Work:** the test SSH server gains an SFTP subsystem (`sftpEntries: N`). `npm run test:perf` (`tests/perf/`) measures and records each metric as JSON in `perf-results/`; a CI job uploads it and prints a table:

| Metric              | Measured as                                 | Target   | Gate                              |
| ------------------- | ------------------------------------------- | -------- | --------------------------------- |
| Terminal round trip | p95 of 200 WebSocket echoes                 | < 50 ms  | hard                              |
| Profile list        | `GET /api/profiles`, 100 profiles, median   | < 200 ms | hard                              |
| SFTP listing        | 1000 entries                                | < 2 s    | hard                              |
| Concurrent sessions | 20 sessions each with a working shell       | 20       | hard (echo); heap growth reported |
| SQLite queries      | audit page over 10 000 rows, profiles, keys | < 50 ms  | hard                              |
| Cold start          | launch → first window (e2e)                 | < 4 s    | soft: fails above 2× the target   |
| Renderer ready      | window → wizard visible (e2e)               | < 1 s    | soft: fails above 2× the target   |

**Acceptance Criteria:**

- [x] Each metric above is measured by a test and written to `perf-results/`
- [x] Hard gates fail the run when exceeded; the CI summary lists every value
- [x] The NFR-01 rows are marked ✅ individually as their check passes

---

### ~~BL-46 — Backend in `utilityProcess` and Electron Fuses~~ ✅ Implemented

**Requirements:** NFR-02
**Priority:** Medium
**Status:** ✅ Implemented 2026-11-22 — regression tests: tests/backend/hostBridgeInit.test.ts, tests/backend/backendHandshake.test.ts, tests/backend/fuses.test.ts, tests/e2e/app.spec.ts; packaged Windows app checked by hand (fuses, renderer, ASAR tamper)

**Problem:** the backend is started as `ELECTRON_RUN_AS_NODE`, which keeps the signed app binary usable as a general Node.js runtime (it also honours `NODE_OPTIONS` and `--inspect`), and the storage key and launch secret travel in environment variables.

**Work (after ADR-005):** the main process starts the backend with `utilityProcess.fork`, passes the storage key and launch secret in the first message instead of the environment, and the host bridge uses `process.parentPort` (the `process.send` path remains for tests); `electron-builder.yml` sets the fuses `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`, `enableCookieEncryption: true` (`grantFileProtocolExtraPrivileges` is decided in the ADR after testing the `file://` load).

**Acceptance Criteria:**

- [x] The backend runs in a utility process; the e2e suite and the supervisor tests pass
- [x] `@electron/fuses read` on the packaged app shows the fuses above
- [x] The storage key and launch secret are not present in the backend's environment
- [x] The packaged Windows app starts on a throwaway profile (checked 2026-11-22)
- [ ] macOS and Linux: the `Check Electron fuses` step of `build.yml` passes in `package.yml` (not yet run)

### ~~BL-47 — Local Files by Grant~~ ✅ Implemented

**Requirements:** NFR-02, FR-04.4, FR-04.5, FR-04.13, FR-04.15, §10.6, §10.7 (ADR-006)
**Priority:** High
**Status:** ✅ Implemented 2026-11-22 — regression tests: tests/backend/localGrants.test.ts, tests/backend/localFiles.test.ts, tests/backend/localGrantService.test.ts, tests/backend/preloadBridge.test.ts, tests/backend/requestValidation.test.ts, tests/backend/backendHandshake.test.ts, tests/renderer/lib/localFiles.test.ts, tests/renderer/components/sftp/LocalFilePane.test.tsx, tests/renderer/components/sftp/SftpPane.test.tsx, tests/e2e/app.spec.ts

Specified 2026-11-22, after GitHub CodeQL (js/path-injection) reported five high alerts on PR #23.

**Problem:** the SFTP upload and download requests carry a raw local path (`localPath`), which the backend passes to `fs` and to ssh2. BL-23 checks only the path's shape, so the page can make the backend read any file the user can read and send it to a server, or write any file the user can write — including the per-user install folder, whose `resources/backend` lies outside ASAR integrity. Related defects: any `text/plain` drop on the remote pane is used as a local path; a remote file name containing `..\` or `\` that is dropped on the local pane escapes the folder on Windows; the local pane cannot go Up to the home folder (Windows) or Up at all (POSIX), and fails silently.

**Decision (ADR-006):** the main process is the only authority for local files. The page never sends a local path to the backend: it sends an opaque grant that main issued for a file or folder the user chose, and the backend asks main to resolve the grant for every transfer.

**Main work:**

- `src/main/localGrants.ts` (no Electron, no fs): a grant is `{ id (128-bit random, hex), kind: read | write | dir, path, windowId, sessionId }`. Only SFTP connection windows get grants, bound to the window's SSH session. A grant lives until its window closes or the app locks (no time limit, so Retry keeps working); a window holds at most 256 (the least recently used is evicted), duplicates are reused, and grant ids are never logged.
- `src/main/localFiles.ts` (dialogs and fs injected) replaces `fs:readDir` and `validateFilePath` in `index.ts`. The IPC handlers serve only SFTP windows:
  - `sftp:readLocalDir(path?)` → `{ path, parent, grant, files }`. An empty path, `.` or none means the home folder; other relative paths, paths outside home and paths inside the app's own `userData` and `sessionData` folders are refused. Paths are compared as native real paths (case-insensitive on Windows; 8.3 names, junctions and symlinks resolved). `parent` is null at home. Folders are detected after following symlinks. The listing's `grant` is a read-only `dir` grant.
  - `sftp:pickUploadFile()` → `{ grant, name } | null` — the native Open dialog, parented to the SFTP window.
  - `sftp:pickDownloadTarget({ name, folder? })` → `{ grant, name } | null` — the native Save dialog, parented, asking before it replaces a file; it opens in the folder of the `folder` grant, with a cleaned name filled in.
  - `sftp:grantDroppedFile(path)` → `{ grant, name } | null`, sent only by the preload. Device paths (`\\.\`, `\\?\`) are refused before any file-system call; the target must be a regular file.
  - Files picked in a native dialog or dropped from the OS are never refused by folder.
- Resolution: the backend sends `{ type: 'grant-resolve', requestId, sessionId, grant, access, name? }`; main answers exactly once with `{ type: 'grant-resolved', requestId, ok: true, path }` or `{ …, ok: false, code }`, `code` ∈ `GRANT_UNKNOWN | GRANT_MISMATCH | NAME_NOT_ALLOWED | REFUSED | NOT_FOUND | NOT_A_FILE`. The access must match the grant's kind (a `dir` grant serves reads only) and the session must match. For a `dir` grant the name is a single path segment — 1–255 characters, not `.` or `..`, no NUL, control characters or `/`; on Windows also none of `\ : * ? " < > |`, no trailing dot or space and no reserved device name (CON, PRN, AUX, NUL, COM0–9, LPT0–9, with or without an extension) — the joined path must stay in the folder (`path.relative(folder, target) === name`), the folder must still resolve to itself, and the real target must be inside home, outside the refused folders, and a regular file.
- Backend messages are routed by `routeBackendMessage`: grant requests first, then the lock messages; anything unknown is ignored and never treated as a lock. Main answers the backend process that asked.
- A lock clears every grant; closing a window drops its grants.

**Backend work:**

- `HostBridge.resolveLocalGrant(request, timeoutMs = 5000)` over `process.parentPort`, matched by `requestId`. Without a parent port, or without an answer in time, the result is `UNAVAILABLE`.
- `LocalGrantService.resolve(sessionId, local, access)` → the path main returned, or a `LocalGrantError` (`400 { error, code }`; `UNAVAILABLE` → `503`).
- `POST /api/sftp/:sessionId/upload { local: { grant, name? }, remotePath, transferId }` and `POST /api/sftp/:sessionId/download { remotePath, local: { grant }, transferId }` use strict schemas: a `localPath` or any other extra key gets `400`. Order: schema → grant resolution → the `LocalPathService` checks (kept as a second line) → the transfer.
- The backend never builds a local path from request data and has no fallback that accepts one.

**Preload work:** add `pickUploadFile`, `pickDownloadTarget`, `grantDroppedFile(file)` — which calls `webUtils.getPathForFile` inside the preload and never returns the path to the page — and the new `readLocalDir`. Remove `openFileDialog`, `openDirectoryDialog`, `saveFileDialog` and `getPathForFile`. Both `src/preload/index.ts` and `index.d.ts`.

**Frontend work:** the transfer store keeps `local: { grant, name? }` instead of `localPath`, so Retry reuses the grant; when a grant is no longer valid, Retry is hidden and the error asks the user to pick the file again. Local-pane rows drag with the type `application/x-cyphershell-local` (`{ grant, name }`); a drop that carries only `text/plain` does nothing. Dropping a remote file on the local pane opens the native Save dialog in that folder with the file name filled in. The local pane goes Up through `parent`, and a refused folder shows a message.

**Acceptance Criteria:**

- [x] No backend endpoint accepts a local path: a request with `localPath` gets 400
- [ ] The five CodeQL path-injection alerts close without new ones (to be confirmed by the CodeQL run on GitHub after the push)
- [x] Uploads work from the Upload button, an OS drop and a local-pane drag; downloads from the Download button and from a drop on the local pane (through the pre-filled Save dialog) — covered by component tests and the e2e round trip
- [ ] The same flows checked by hand in the packaged app against a real SSH server (not yet done)
- [x] A grant is refused for another session, after its window closes, after a lock, and for the wrong access; a `dir` grant refuses `..`, path separators and Windows device names
- [x] The local pane lists the home folder, goes Up to it, and refuses the app's own data folders — also through a symlink or junction, a different letter case or an 8.3 name
- [x] A drop that carries only `text/plain` uploads nothing
- [x] Retry reuses the grant; a grant that is no longer valid hides Retry and asks to pick the file again
- [x] An e2e test covers the real main ↔ backend round trip

---

_End of SRS Document — v3.7_
