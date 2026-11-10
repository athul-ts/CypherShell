# Software Requirements Specification (SRS)

## CypherShell — Secure SSH Desktop Client

**Version:** 3.3
**Author:** Athul T S
**Date:** 2026-11-10
**Status:** Living Document — v1.0 Feature Complete, v1.1 Backlog Active (BL-10 … BL-16 implemented 2026-11-10)

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
| OS           | Windows 10+, macOS 12+, Ubuntu 20.04+                              |
| Architecture | x64, ARM64 (Apple Silicon)                                         |
| Runtime      | Node.js 20+ bundled inside Electron — user installs nothing        |
| Electron     | v39                                                                |
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
│  │  openFileDialog, appVersion │                         │
│  │  fs:readDir, fs:executeOp   │                         │
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

- Uses `portfinder` to find a free localhost port starting from 4000
- Sets `process.env.DATABASE_URL = file:{userData}/sshclient.db`
- Spawns Express.js backend as a child process using Electron's bundled Node.js (`ELECTRON_RUN_AS_NODE=1`)
- Creates `BrowserWindow`, loads Vite renderer
- Passes backend port to preload via IPC channel (`get-backend-port`)
- Handles: window lifecycle, native file dialogs, auto-updater (startup + every 4 hours)
- Writes diagnostic logs to `{userData}/app.log`
- Generates a per-install JWT secret and a storage key (wrapped with Electron `safeStorage` when available) under `{userData}/secrets/` and passes both to the backend as environment variables
- Gracefully terminates the backend child process on app quit
- Restarts the backend if it exits unexpectedly — same port, backoff 1 s → 2 s → 4 s → 8 s, gives up after 5 crashes within 2 minutes — then sends `backend:restarted` to every window ✅ (BL-16, `src/main/backendSupervisor.ts`)
- IPC handlers exposed:
  - `ping` — health check
  - `get-backend-port` — returns the backend port
  - `get-app-version` — returns `app.getVersion()`, the app version from the packaged `package.json`
  - `dialog:openFile` — native OS file picker
  - `dialog:openDirectory` — native OS directory picker
  - `dialog:saveFile` — native OS save dialog
  - `dialog:openJsonFile` — file picker filtered to `.json` (profile import)
  - `dialog:openCskbFile` — file picker filtered to `.cskb` (key bundle import)
  - `window:openTerminal` — spawns standalone terminal window
  - `window:openSftp` — spawns standalone SFTP window
  - `get-connection-token` — one-time JWT hand-off to a newly opened connection window (SEC-07)
  - `fs:readDir` — reads local directory listing for SFTP local pane
  - `fs:executeOp` — local FS operations (`mkdir`, `rename`, `delete`, `writeFile`, `readFile`), restricted to paths inside the user's home directory
  - `updater:install` — triggers update install and app restart
  - `backend:restarted` (main → renderer event) — the backend was restarted after a crash; windows re-authenticate (BL-16)

### 4.2 Preload Script (`src/preload/index.ts`)

Runs in an isolated context with Node.js access. Exposes a safe `window.api` surface:

```typescript
interface ElectronAPI {
  backendPort: number
  appVersion: string
  openFileDialog: () => Promise<string[]>
  openDirectoryDialog: () => Promise<string | null>
  saveFileDialog: (defaultName: string) => Promise<string | null>
  openJsonFileDialog: () => Promise<string[]>
  openCskbFileDialog: () => Promise<string[]>
  openTerminalWindow: (sessionId: string, profileId: string, title: string, token: string) => void
  openSftpWindow: (sessionId: string, profileId: string, title: string, token: string) => void
  getConnectionToken: (sessionId: string) => Promise<string | null>
  readLocalDir: (dirPath?: string) => Promise<{ path: string; files: DirEntry[] }>
  executeLocalFileOp: (op: LocalFileOp, args: LocalFileOpArgs) => Promise<unknown>
  onUpdateAvailable: (cb: () => void) => () => void // returns an unsubscribe function
  onUpdateDownloaded: (cb: () => void) => () => void
  onBackendRestarted: (cb: () => void) => () => void // BL-16
  installUpdate: () => Promise<void>
}
```

No raw Node.js or Electron APIs are exposed directly to the renderer.

### 4.3 Renderer — React SPA (`src/renderer/`)

- Pure React SPA, built and served by Vite
- Uses `HashRouter` from React Router v7 — required for `file://` protocol
- Reads `window.api.backendPort` to build the base URL for all API calls
- State machine in `App.tsx`: `loading → setup | locked | unlocked → error`
- REST via Axios (with JWT interceptor) for all CRUD and SFTP operations
- WebSocket via native `WebSocket` API for SSH terminal I/O (base64 framing)
- SSE via native `EventSource` API for real-time SFTP transfer progress streaming
- Zustand manages global in-memory state: open sessions, tab order, transfer queue, terminal theme
- TanStack Query manages all server-state: profiles, keys, logs (caching + retry)
- Auto-lock timer enforced in `App.tsx` based on `config.autoLockMinutes`
- Standalone connection windows (`/connection/terminal/:sessionId`, `/connection/sftp/:sessionId`) obtain the JWT through the one-time `get-connection-token` IPC hand-off (SEC-07). ⚠️ The production build still also appends the token to the window's URL hash
- `UpdateBanner` component listens for auto-update events and shows install prompt

### 4.4 Express.js Backend (`backend/src/`)

- Bound to `127.0.0.1:{port}` — not `0.0.0.0`
- Maintains an in-memory session pool: `Map<sessionId, ssh2.Client>`
- `ws` WebSocket server shares the same `http.Server` instance
- SSE endpoints (`text/event-stream`) stream SFTP transfer progress — no polling
- `requireAuthFlexible` middleware accepts JWT from query param (needed for `EventSource` which cannot set headers)
- Prisma handles all SQLite reads/writes; WAL mode enabled on startup
- Rate limiting: 5 unlock attempts/min, 300 API requests/min (configured in `backend/src/index.ts`)
- JWTs are issued for 1 hour and carry a `jti` held in an in-memory `TokenStore`; locking the app revokes every issued token
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
User clicks Upload in SFTP pane (native file dialog returns a local path)
  → EventSource opens GET /api/sftp/:sessionId/progress/:transferId first
  → Axios POST JSON to /api/sftp/:sessionId/upload
      Body: { transferId, localPath, remotePath }
    → Express controller → SftpService.upload(sessionId, localPath, remotePath, transferId)
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
│   │   ├── index.ts                      # Window creation, backend spawn, IPC, updater, path validation
│   │   └── backendSupervisor.ts          # Restart-on-crash policy for the backend child (BL-16)
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
│       │   └── config.routes.ts          # /api/config
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
│       │   ├── audit.service.ts          # Event logging + CSV export
│       │   ├── config.service.ts         # App config read/update (singleton row)
│       │   ├── token-store.service.ts    # Issued JWT ids (revocation on lock)
│       │   └── logger.service.ts         # Timestamped stdout/stderr logger
│       ├── websocket/
│       │   └── terminal.ws.ts            # WS handler — xterm.js ↔ ssh2 bridge
│       ├── middleware/
│       │   └── auth.middleware.ts        # JWT verification (header + query param)
│       └── config/
│           ├── db.ts                     # initDatabase() — migrate + WAL + connect
│           └── env.ts                    # JWT_SECRET
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
├── scripts/                              # Build helpers (rebuild-native, after-pack)
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

---

## 6. Functional Requirements

### FR-01: Saved Connection Profiles

**Priority:** High | **Status:** ⚠️ Partially Implemented (FR-01.2, FR-01.8.7 tracked)

- FR-01.1 — Profile fields: Name, Host, Port (default 22), Username, Auth method (Password / SSH Key / Key + Passphrase) ✅ (BL-13)
- FR-01.2 — Home page shows profile cards: name, host, group tag, last connected time ⚠️ — `lastConnectedAt` is never written on connect and the cards do not show it (tracked, not scheduled)
- FR-01.3 — "Manage Profile" opens a Profile Detail tab; Terminal and SFTP windows spawn from there
- FR-01.4 — Stored in SQLite via Prisma; passwords/passphrases AES-256-GCM encrypted before write
- FR-01.5 — Profiles can be duplicated with one click ✅
- FR-01.6 — Profiles can be tagged/grouped (e.g. "Production", "Staging") ✅
- FR-01.7 — Real-time search and filter by name or host ✅
- FR-01.8 — Edit an existing profile's fields via an "Edit Profile" action accessible from the Profile Detail tab and from the profile card context menu on the Home page ✅

### FR-01.8: Profile Edit

**Priority:** High | **Status:** ⚠️ Partially Implemented (FR-01.8.7 tracked)

#### Requirements

- FR-01.8.1 — An "Edit Profile" button is present in the Profile Detail tab header area ✅
- FR-01.8.2 — A per-profile "Edit" option is available in the profile card context/action menu on the Home page (alongside Duplicate, Delete, Export) ✅
- FR-01.8.3 — Activating either entry opens the existing `ProfileForm` dialog pre-populated with the current profile's values ✅
- FR-01.8.4 — On save, the form issues `PUT /api/profiles/:id` with only the changed fields ✅ (BL-13) — the password or passphrase is sent only when typed, and switching to plain SSH-key auth sends `password: ''` to clear it (FR-01.8.6)
- FR-01.8.5 — On successful save, TanStack Query caches for `['profiles']` and `['profile', profileId]` are invalidated so all views reflect the update immediately ✅
- FR-01.8.6 — If the profile's `authMethod` changes (e.g. from Password to SSH Key), the form clears the irrelevant credential fields before submitting ✅
- FR-01.8.7 — Form validation mirrors the create flow: Name, Host, Port, and Username are required; Port must be 1–65535 ⚠️ — enforced by HTML `required` and the API only; there are no inline field errors (tracked, not scheduled)

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

**Priority:** High | **Status:** ⚠️ Partially Implemented (FR-02.3, FR-02.6, FR-02.7 tracked)

- FR-02.1 — Connecting opens a Profile Details tab; users spawn standalone terminal console windows from it ✅
- FR-02.2 — xterm.js renders with full ANSI colour and escape sequence support, including UTF-8 text ✅ (BL-15 — output is written as bytes and input is encoded as UTF-8)
- FR-02.3 — PTY resizes dynamically when the standalone window resizes (`@xterm/addon-fit`) ⚠️ — resizes work, but the first resize is sent before the remote shell is ready and is dropped, so a new terminal starts at 80×24 until the window is resized (tracked, not scheduled)
- FR-02.4 — Copy (Ctrl+Shift+C) supported; right-click pastes the clipboard ✅ (BL-08)
- FR-02.5 — Full keyboard support: Ctrl+C, Ctrl+Z, Tab, arrow keys, function keys ✅
- FR-02.6 — Auto-reconnect on drop: exponential backoff (1s → 2s → 4s), max 3 retries ⚠️ — a reconnect opens a fresh shell instead of resuming, a normal `exit` also triggers it, and an SSH-level drop is never re-established (the session is gone). The 15 s deferred cleanup that tore down the whole session is removed by BL-11; reconnect semantics are tracked, not scheduled
- FR-02.7 — Connection status badge: connected / reconnecting / disconnected ⚠️ — the badge shows Connecting / Connected / Connection Lost; there is no "reconnecting" state (tracked, not scheduled)
- FR-02.8 — Closing standalone terminal window closes its shell; the SSH session stays open while other terminals, tunnels, transfers or an open Profile Details tab use it ✅ (BL-11)
- FR-02.9 — The JWT reaches popup windows through a one-time IPC hand-off — no re-auth required ✅ (⚠️ production builds also append it to the URL hash; see NFR-02)
- FR-02.10 — Terminal font, font size, and color theme customizable ✅ (changes apply to newly opened terminals)
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

**Priority:** High | **Status:** ⚠️ Partially Implemented (FR-04.4, FR-04.7, FR-04.13, FR-04.15 tracked)

- FR-04.1 — SFTP Explorer opens in standalone window from Profile Details tab ✅
- FR-04.2 — Left pane: local machine files; Right pane: remote server files ✅
- FR-04.3 — Navigate by double-clicking folders ✅
- FR-04.4 — Upload: Upload button (native file dialog) + drag-and-drop ⚠️ — the button and drags from the local pane work; dragging files in from the OS reads `File.path`, which Electron removed in v32 (tracked, not scheduled)
- FR-04.5 — Download: Download button (native save dialog) ✅
- FR-04.6 — Rename in-place via the row action and F2 ✅ (BL-14 — in-app dialog)
- FR-04.7 — Delete with confirmation ⚠️ — works for files; deleting a folder uses `unlink` and fails (tracked, not scheduled)
- FR-04.8 — Create new folder via button and Ctrl+Shift+N ✅ (BL-14 — in-app dialog)
- FR-04.9 — Show and edit Unix permissions (chmod) ✅ (BL-14 — in-app dialog with octal validation)
- FR-04.10 — Per-transfer progress via SSE: filename, bytes, %, speed + elapsed computed from progress deltas ✅
- FR-04.11 — Multiple simultaneous transfers in a queue; each has its own SSE stream and its own SFTP channel ✅ (BL-14)
- FR-04.12 — Transfer history: completed, active, and failed ✅
- FR-04.13 — Failed transfers: one-click retry with error reason shown ⚠️ — the error reason is shown; there is no retry action (tracked, not scheduled)
- FR-04.14 — Toggle hidden files (dotfiles) ✅
- FR-04.15 — Breadcrumb path bar in both panes with click-to-navigate ⚠️ — the breadcrumbs work, but remote paths stay relative to the login directory, so directories above it (`/etc`, `/var/www`) cannot be reached; the local pane is limited to the home directory (tracked, not scheduled)
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

**Priority:** High | **Status:** ⚠️ Partially Implemented (FR-06.6 UI tracked)

- FR-06.1 — Local forwarding: `localhost:localPort → remoteHost:remotePort` ✅ (BL-16 — a client reset no longer crashes the backend)
- FR-06.2 — Remote forwarding: `remoteHost:remotePort → localhost:localPort` ✅
- FR-06.3 — Dynamic SOCKS5 proxy ✅
- FR-06.4 — Tunnel panel displayed inline inside Profile Details tab ✅ (tunnel rules are not saved to the `Tunnel` table; only profile import/export touches it — tracked, not scheduled)
- FR-06.5 — Start/stop individual tunnels without interrupting terminal/SFTP windows ✅
- FR-06.6 — Port conflict detection before binding ⚠️ — the backend detects a busy port (BL-02), but the UI shows a generic "Failed to start tunnel" instead of the busy port (tracked, not scheduled)

---

### FR-07: Application Lock

**Priority:** Medium | **Status:** ⚠️ Partially Implemented (FR-07.5 tracked; FR-07.8 not implemented)

- FR-07.1 — First-run setup wizard: set master password or skip ✅ (BL-10 — startup jobs no longer create the config row)
- FR-07.2 — Lock screen shown on app open if lock is enabled ✅
- FR-07.3 — Master password hashed with bcrypt (cost 12) ✅
- FR-07.4 — PBKDF2-SHA512 derives AES key from master password at unlock — memory only ✅
- FR-07.5 — Auto-lock after configurable idle timeout (default 15 minutes) ⚠️ — the timer works, but idle time is tracked per window, and open terminal/SFTP windows stay usable after locking (see NFR-02 additions)
- FR-07.6 — Lost master password = all encrypted data permanently unrecoverable — shown prominently ✅
- FR-07.7 — Changing the lock mode never loses data: setting a master password on a skip-lock install, or turning lock off, re-encrypts every stored secret under the new key in a single transaction, and turning lock off requires the current master password ✅ (BL-10 — `SecretsService.rekey`, `POST /api/auth/setup-password`, `POST /api/auth/disable-lock`)
- FR-07.8 — Change master password (current + new password; all secrets re-encrypted in one transaction) ❌ — not implemented, not scheduled

---

### FR-08: Audit Logs

**Priority:** Medium | **Status:** ⚠️ Partially Implemented (FR-08.2, FR-08.5, FR-08.6 tracked)

- FR-08.1 — Log: SSH connect (profile, host, timestamp, success/fail, error message) ✅
- FR-08.2 — Log: SSH disconnect with duration and reason ⚠️ — duration is logged, but the reason is always "Connection closed", and an error after connecting writes a "connection failed" entry plus two disconnect entries (tracked, not scheduled)
- FR-08.3 — Log: SFTP upload (filename, size, remote path, timestamp, success/fail) ✅
- FR-08.4 — Log: SFTP download (filename, size, local path, timestamp) ✅
- FR-08.5 — Paginated log table with search and date range filter ⚠️ — only the newest 100 entries are fetched and filtered in the browser; there is no pagination (tracked, not scheduled)
- FR-08.6 — Export logs as CSV via native save dialog ⚠️ — the button navigates the window to the export URL without the JWT, so the app is replaced by a 401 page (tracked, not scheduled)
- FR-08.7 — Auto-purge logs older than N days — at startup and every 24 hours ✅ (BL-04, BL-10)
- FR-08.8 — Clear all logs via UI with confirmation (`DELETE /api/audit`) ✅ (BL-06)

---

### FR-09: Profile Export/Import

**Priority:** Medium | **Status:** ✅ Implemented (FR-09.2 field list corrected — see note)

Export and import connection profiles as JSON files for backup, sharing, and migration. SSH key material is intentionally excluded from profile exports — keys are managed separately via FR-10.

- FR-09.1 — Export selected profiles or all profiles as a `.json` file via native save dialog ✅
- FR-09.2 — Exported JSON includes all profile metadata: `name`, `host`, `port`, `username`, `authMethod`, `group`, `terminalTheme`, `fontSize`, `autoReconnect`, and port-forwarding rules ✅ (corrected in v3.3: Profile has no `description` column; the exported rules are empty until the UI saves tunnels — see FR-06.4)
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

**Priority:** Medium | **Status:** ⚠️ Mostly Implemented (FR-10.6 Overwrite tracked)

Export SSH keys as encrypted `.cskb` (CypherShell Key Bundle) files for backup and migration. The bundle re-encrypts the private key with a user-supplied passphrase so it is never written to disk unprotected. Import restores from a `.cskb` file and re-encrypts with the current app master key.

- FR-10.1 — Export a key as an encrypted `.cskb` file via native save dialog; only one key per export file ✅
- FR-10.2 — The `.cskb` bundle is a JSON envelope containing: `version`, `keyName`, `keyType`, `description`, `publicKey` (plaintext), `encryptedPrivateKey` (AES-256-GCM), `iv`, `salt`, `authTag` — where the encryption key is derived from the user-supplied export passphrase via PBKDF2-SHA512 (200 000 iterations) ✅
- FR-10.3 — User must supply and confirm an export passphrase before export proceeds — the file is never written without passphrase encryption ✅
- FR-10.4 — Import a `.cskb` file via native file picker ✅
- FR-10.5 — On import, user is prompted for the export passphrase; the private key is unwrapped, then immediately re-encrypted with the current app master key and stored in the database — the export passphrase is not retained ✅ (keys with their own passphrase round-trip since BL-12)
- FR-10.6 — On import conflict (key name already exists), the user is shown: **Skip**, **Rename** (append suffix), or **Overwrite** ✅ ⚠️ — Overwrite deletes the old key and creates a new one, unlinking the profiles that used it (tracked, not scheduled)
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

**Priority:** High | **Status:** ❌ Not Implemented (not scheduled)

CypherShell currently accepts whatever host key a server presents (no `hostVerifier` in the ssh2 connect config), so anyone on the network path can impersonate a server and capture passwords. This requirement adds trust-on-first-use (TOFU) verification, the model OpenSSH uses with `known_hosts`.

- FR-11.1 — On the first connection to a `host:port`, the server's key type and SHA-256 fingerprint are shown, and the user must accept them before any authentication is attempted ❌
- FR-11.2 — Accepted host keys are stored per `host:port` in a new `KnownHost` table (key type, SHA-256 fingerprint, first-seen and last-seen timestamps) ❌
- FR-11.3 — If a later connection presents a different key for the same `host:port`, the connection is aborted before any credential is sent, and a prominent warning shows the stored and presented fingerprints ❌
- FR-11.4 — Known hosts can be listed and removed in Settings, so a legitimately re-keyed server can be trusted again ❌
- FR-11.5 — Host-key decisions (accepted, declined, mismatch) are written to the audit log ❌

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

| Metric                                  | Target                   |
| --------------------------------------- | ------------------------ |
| App cold start (Electron window open)   | < 4 seconds              |
| Vite renderer ready after window opens  | < 1 second               |
| SSH terminal input-to-display latency   | < 50ms                   |
| Profile list load (100 profiles)        | < 200ms                  |
| SFTP directory listing (1000 files)     | < 2 seconds              |
| Maximum concurrent SSH sessions         | 20 without memory issues |
| SQLite query time (all typical queries) | < 50ms                   |

⚠️ These targets have not been measured — no benchmark or timing test exists (tracked, not scheduled).

### NFR-02: Security

- All passwords, passphrases, private keys AES-256-GCM encrypted before DB write
- AES key derived at runtime from master password via PBKDF2-SHA512 — never persisted
- Private key material never sent across IPC bridge to renderer
- Express bound to `127.0.0.1` only — never `0.0.0.0`
- JWT expires after 1 hour (`expiresIn: '1h'`), re-issued on unlock; the renderer re-authenticates when a request outside `/api/auth` returns 401 ✅ (BL-16)
- All API inputs validated with zod before reaching controllers ⚠️ — the profile, auth and key routes validate; SFTP, tunnel and config bodies are unvalidated (tracked, not scheduled)
- SFTP file paths sanitized server-side — no `..` traversal ⚠️ — not implemented; for a user with shell access, remote `..` is not a security boundary, so this item should be reworded to validate the **local** paths the backend reads and writes (tracked, not scheduled)
- Context isolation enabled in Electron — renderer has no direct Node.js access
- SSH host keys are verified before authentication (FR-11) ❌
- The local API accepts requests only from CypherShell's own renderer: a per-launch secret on `/api/auth/*` and the WebSocket upgrade, a strict Origin allowlist (no `null`, no arbitrary localhost origins in production) and a `Host` header check against DNS rebinding ❌ — today CORS allows `null` and any localhost origin, and `/api/auth/unlock` issues a token without a password when lock is off (not scheduled)
- Token revocation is enforced on every transport (REST, SSE, WebSocket), and locking closes open terminal and SFTP sessions ❌ — the WebSocket checks only the JWT signature (not scheduled)

### NFR-03: Reliability

- SSH session errors are isolated per tab — one failure does not affect others ✅ (BL-16 — every forwarded socket has an error handler)
- Auto-reconnect: exponential backoff (1s → 2s → 4s), max 3 retries ⚠️ (see FR-02.6)
- Electron main auto-restarts Express if it crashes unexpectedly ✅ (BL-16)
- SQLite WAL mode — prevents corruption on force-quit

### NFR-04: Usability

- Familiar to anyone who has used PuTTY, MobaXterm, or Bitvise
- All destructive actions require explicit confirmation
- Every async operation has a loading state
- All errors shown in plain language with a retry option
- Keyboard navigable throughout

### NFR-05: Cross-Platform

- Identical behaviour on Windows, macOS, and Linux
- Native file dialogs via Electron IPC for all file/directory selection
- `path.posix` for remote paths, `path` (OS-aware) for local paths
- Keyboard shortcuts adapted per OS via Electron accelerators ⚠️ — no application accelerators are defined; shortcuts are handled in the renderer (tracked, not scheduled)

### NFR-06: Maintainability

- 100% TypeScript — renderer, backend, main, preload; all three are type-checked by `npm run typecheck`
- ESLint + Prettier enforced
- Business logic only in services — controllers are thin ⚠️ — the profile and auth controllers still call Prisma directly (tracked, not scheduled)
- Prisma schema is the single source of truth for data shapes

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
- Native modules (`better-sqlite3`) are rebuilt for the **target architecture and Electron ABI** during packaging, and the resulting binary is verified to match the target architecture before the installer is created.
- Auto-update metadata (`latest.yml`, `latest-linux.yml`, `latest-mac.yml`) and blockmaps are published alongside the installers, so the in-app `electron-updater` feed resolves.
- Installer filenames identify their platform and architecture (`CypherShell-<version>-<platform>-<arch>[-setup].<ext>`, platform ∈ `windows` | `macos` | `linux`), so a Release's flat asset list is unambiguous. The `latest*.yml` and `.blockmap` filenames are exempt — `electron-updater` resolves those by exact name, so they must not be renamed.
- The macOS `.zip` target is required — `electron-updater` cannot install from a `.dmg`.
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
POST  /api/auth/setup           { password }  → First run: set master password → { token }
POST  /api/auth/setup/skip                    → First run: skip lock (storage-key encryption) → { token }
POST  /api/auth/unlock          { password? } → Verify master password → { token }   (5 attempts/min)
POST  /api/auth/lock                          → Clear the active AES key, revoke all tokens   (JWT)
POST  /api/auth/setup-password  { password }  → Skip-lock install → enable lock; re-encrypts all secrets (FR-07.7)   (JWT)
POST  /api/auth/disable-lock    { password }  → Verify master password, turn lock off; re-encrypts all secrets (FR-07.7)   (JWT)
```

Only `status`, `setup`, `setup/skip` and `unlock` are reachable without a JWT.

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
POST   /api/profiles/:id/connect      → Open SSH connection → { sessionId: string }
```

### 9.4 Sessions API

```
GET    /api/sessions                  → { sessions: [{ id, profileId, profileName, host, connectedAt, consumers }] }
GET    /api/sessions/:sessionId       → { alive: boolean } — also renews the session's heartbeat lease (BL-11)
DELETE /api/sessions/:sessionId       → Disconnect session (closes its shells, SFTP and tunnels)
```

### 9.5 WebSocket — Terminal

```
WS  ws://127.0.0.1:{port}/ws/terminal/:sessionId?token=<JWT>

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
POST   /api/sftp/:sessionId/upload    { localPath, remotePath, transferId }  → { success, transferId } (progress via SSE)
POST   /api/sftp/:sessionId/download  { remotePath, localPath, transferId }  → { success, transferId } (progress via SSE)
POST   /api/sftp/:sessionId/delete    { remotePath }                         → Delete file
POST   /api/sftp/:sessionId/rename    { oldPath, newPath }                   → Rename/move
POST   /api/sftp/:sessionId/mkdir     { remotePath }                         → Create directory
POST   /api/sftp/:sessionId/chmod     { remotePath, mode }                   → Change permissions (mode: octal string or number)
GET    /api/sftp/:sessionId/progress/:transferId ?token=<JWT>                → SSE progress stream
DELETE /api/sftp/:sessionId/transfer/:transferId                             → Cancel an in-progress transfer (BL-01)
```

Upload and download take paths on the local disk (chosen through native dialogs), not multipart bodies.

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
POST   /api/tunnels/:sessionId/start  { type: 'local' | 'remote' | 'dynamic', localPort, remoteHost?, remotePort? }
POST   /api/tunnels/:sessionId/stop   { type, port }   — port is localPort for local/dynamic, remotePort for remote
```

### 9.9 Audit Logs API

```
GET    /api/audit     ?limit=100      → Newest entries first (default 100)
GET    /api/audit/export              → CSV download (Content-Disposition: attachment)
DELETE /api/audit                     → Clear all logs (BL-06)
```

> The earlier design (`GET /api/logs ?type=&from=&to=&page=`) with server-side filtering and pagination is not implemented; the renderer filters the fetched page (see FR-08.5).

### 9.10 App Config API

```
GET    /api/config    → { theme, defaultFont, defaultFontSize, logRetentionDays, lockEnabled, hasMasterPassword, autoLockMinutes, … }
PUT    /api/config    → Update theme, fonts, autoLockMinutes, logRetentionDays
```

`masterPasswordHash` and `encryptionKeySalt` are never returned. `lockEnabled` is read-only here — it changes only through `POST /api/auth/setup-password` and `POST /api/auth/disable-lock` (FR-07.7).

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
- The JWT secret

### 10.4 Network Binding

Express bound to `127.0.0.1:{port}` — not `0.0.0.0`. The port is not externally reachable.

### 10.5 Rate Limiting

| Endpoint                | Limit             |
| ----------------------- | ----------------- |
| `POST /api/auth/unlock` | 5 attempts/minute |
| All other API endpoints | 300 req/minute    |

### 10.6 Input Validation

- All request bodies validated with `zod` schemas ⚠️ — done in the profile, auth and key-bundle controllers only (see NFR-02)
- SSH hostnames validated against RFC 1123 ⚠️ — not implemented; any non-empty host is accepted (tracked, not scheduled)
- Ports validated (1–65535) ✅ for profiles and imported tunnels
- SFTP remote paths sanitized — `..` traversal rejected ⚠️ — not implemented; see the rewording note in NFR-02

### 10.7 Electron Security

- `contextIsolation: true` — renderer has no direct Node.js access
- `nodeIntegration: false` in renderer
- All Node.js APIs exposed only via typed `contextBridge` surface
- Standalone connection windows receive the JWT through a one-time IPC hand-off (`get-connection-token`) — no credential storage in window state ⚠️ — production builds also append the token to the window URL hash (tracked, not scheduled)

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
- **Light**: `#ffffff` bg, `#111827` text ⚠️ — no light styles exist yet; choosing Light changes nothing (tracked, not scheduled)
- **System**: follows OS preference (`prefers-color-scheme`)
- **Terminal schemes** (6 options): Default Dark, Dracula, Nord, Solarized Dark, Monokai, One Dark

### 11.3 Typography

- UI font: system font stack (SF Pro / Segoe UI / Ubuntu)
- Terminal font: JetBrains Mono — bundled as a local font asset, not fetched from CDN ⚠️ — not bundled yet; the terminal falls back to Consolas / the system monospace font (tracked, not scheduled)
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
| `better-sqlite3` native binary bundling in Electron | Medium     | `after-pack.cjs` rebuilds the `.node` binary against Electron's ABI in the staging area; `bindings` + `file-uri-to-path` ship as `extraResources`                                                                                                                    |
| SQLite corruption on OS force-kill                  | Low        | WAL mode enabled on DB init                                                                                                                                                                                                                                          |
| Prisma engine binary missing in packaged app        | Medium     | Resolved — `binaryTargets = ["native"]` only; Prisma CLI not shipped; migrations applied via `better-sqlite3` at startup                                                                                                                                             |
| Electron bundle > 200MB                             | Resolved   | esbuild bundles backend pure-JS deps inline; installer is ~101 MB                                                                                                                                                                                                    |
| Windows SFTP path separator issues                  | Medium     | Always use `path.posix` for remote paths                                                                                                                                                                                                                             |
| Port collision on backend auto-assign               | Low        | `portfinder` scans from 4000 upward                                                                                                                                                                                                                                  |
| macOS Gatekeeper blocks unsigned builds             | Medium     | Builds are unsigned by design (ADR-004). Users clear it via **System Settings → Privacy & Security → Security → Open Anyway**, or `xattr -dr com.apple.quarantine`. The Control-click → **Open** override was removed in macOS 15 Sequoia and must not be documented |

---

## 16. Implementation Status

Current build state as of v3.3 of this document (spec audit, 2026-11-10). A row returns to ✅ when its backlog item lands.

| Module                     | Status      | Notes                                                                                     |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Electron main process      | ✅ Complete | Backend spawn + crash restart (BL-16), IPC, auto-updater, app.log                         |
| Preload / contextBridge    | ✅ Complete | Full typed window.api surface                                                             |
| App auth state machine     | ✅ Complete | loading → setup/locked/unlocked flow; re-auth on 401 / backend restart (BL-10, BL-16)     |
| SetupWizard page           | ✅ Complete | First-run master password setup                                                           |
| LockScreen page            | ✅ Complete | Unlock with bcrypt verify + JWT                                                           |
| Home page / Profile grid   | ✅ Complete | Search, filter, CRUD, duplicate, export/import                                            |
| ProfileDetailPane          | ✅ Complete | Connect/disconnect, tunnel panel, window spawning                                         |
| ProfileForm                | ✅ Complete | Create/edit with key selector; edits send only changed fields (BL-13)                     |
| TerminalPane (xterm.js)    | ✅ Complete | WebSocket I/O (UTF-8, BL-15), resize, themes, search                                      |
| TabBar                     | ✅ Complete | DnD reorder, close, Home anchor tab                                                       |
| SftpPane (dual-pane)       | ✅ Complete | All file ops via in-app dialogs, progress, transfer queue (BL-14)                         |
| LocalFilePane              | ✅ Complete | Local FS browsing via Electron IPC (home directory only)                                  |
| Keys page                  | ✅ Complete | Generate, import, copy, export, delete, export/import .cskb bundle                        |
| Logs page                  | ⚠️ Partial  | Filter, search, date range; CSV export button is broken (FR-08.6)                         |
| Settings page              | ✅ Complete | Theme, font, lock (re-encrypting, BL-10), retention                                       |
| UpdateBanner               | ✅ Complete | Auto-update notification + install                                                        |
| SSH service                | ✅ Complete | Session pool, password + key auth, consumer-aware reaper (BL-11)                          |
| SFTP service               | ✅ Complete | All file ops + SSE progress; one channel per transfer (BL-14)                             |
| Crypto service             | ✅ Complete | AES-256-GCM + PBKDF2 (master key + passphrase-based)                                      |
| Key service                | ✅ Complete | OpenSSH generation (BL-12), import + conversion, fingerprint, .cskb export/import         |
| Tunnel service             | ✅ Complete | Local, remote, dynamic SOCKS5; socket errors handled (BL-16)                              |
| Audit service              | ✅ Complete | Event logging + CSV generation                                                            |
| Config service             | ✅ Complete | AppConfig singleton read/update; never creates the row (BL-10)                            |
| Profile service            | ✅ Complete | Export payload builder, conflict check, import with resolution                            |
| WebSocket terminal handler | ✅ Complete | Bidirectional base64 SSH I/O; session-id parsing fixed, consumer counting (BL-11)         |
| Auth middleware            | ✅ Complete | JWT + query-param fallback for SSE                                                        |
| Rate limiting              | ✅ Complete | 5/min unlock, 300/min API                                                                 |
| Database schema            | ✅ Complete | 5 models, Prisma migrations, WAL mode                                                     |
| Build pipeline             | ✅ Complete | Win/Linux/macOS installers via CI matrix (NFR-07); ~101 MB (esbuild + runtime migrations) |

---

## 17. v1.1 Backlog — Unimplemented Requirements

BL-01 … BL-09 are the v1.0 gaps scheduled for v1.1. BL-10 … BL-16 come from the spec audit of 2026-11-10, which found requirements marked ✅ whose implementation does not work. All seven were implemented the same day, each with regression tests. Smaller gaps found by the same audit are recorded as ⚠️ notes on their requirement in §6/§7 ("tracked, not scheduled").

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

⚠️ Not built: the structured `{ code: 'PORT_IN_USE', port }` error and the frontend warning; `ProfileDetailPane` shows a generic "Failed to start tunnel" toast (tracked, not scheduled).

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

### BL-05 — SSH Disconnect Reason Logging ⚠️ Partially Implemented

**Requirement:** FR-08.2
**Priority:** Low

Implemented: disconnects are logged with their duration.

⚠️ Remaining: the reason is always "Connection closed" (user, idle-reap and error disconnects are not distinguished), and because the pre-ready `error` listener stays attached, an error after connecting writes a "connection failed" entry plus two disconnect entries (tracked, not scheduled).

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

_End of SRS Document — v3.3_
