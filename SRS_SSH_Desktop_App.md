# Software Requirements Specification (SRS)

## CypherShell — Secure SSH Desktop Client

**Version:** 3.2
**Author:** Athul T S
**Date:** 2026-06-13
**Status:** Living Document — v1.0 Feature Complete, v1.1 Backlog Active

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
| Backend          | Express.js + TypeScript        | 4        | Simple, fast, full Node.js runtime for native modules                                      |
| SSH              | ssh2                           | Latest   | Most popular Node.js SSH library, actively maintained                                      |
| SFTP             | ssh2-sftp-client               | Latest   | Wraps ssh2 for clean SFTP operations                                                       |
| WebSocket        | ws                             | Latest   | Lightweight WebSocket server for SSH terminal I/O streaming                                |
| Database         | SQLite + Prisma                | Latest   | Zero install, single file DB, full auto-generated TS types                                 |
| SQLite Adapter   | better-sqlite3                 | Latest   | Native WAL-mode SQLite bindings                                                            |
| Password Hashing | bcrypt                         | Latest   | Master password hashing (cost factor 12)                                                   |
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
│  │  - system tray              │                         │
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
- Gracefully terminates the backend child process on app quit
- IPC handlers exposed:
  - `ping` — health check
  - `get-backend-port` — returns the backend port
  - `dialog:openFile` — native OS file picker
  - `dialog:openDirectory` — native OS directory picker
  - `dialog:saveFile` — native OS save dialog
  - `window:openTerminal` — spawns standalone terminal window
  - `window:openSftp` — spawns standalone SFTP window
  - `fs:readDir` — reads local directory listing for SFTP local pane
  - `fs:executeOp` — local FS operations (mkdir, rename, delete, write)
  - `updater:install` — triggers update install and app restart

### 4.2 Preload Script (`src/preload/index.ts`)

Runs in an isolated context with Node.js access. Exposes a safe `window.api` surface:

```typescript
interface ElectronAPI {
  backendPort: number
  openFileDialog: () => Promise<string[]>
  openDirectoryDialog: () => Promise<string>
  saveFileDialog: (defaultName: string) => Promise<string | null>
  appVersion: string
  openTerminalWindow: (sessionId: string, token: string) => void
  openSftpWindow: (sessionId: string, token: string) => void
  readDir: (dirPath: string) => Promise<DirEntry[]>
  executeOp: (op: FsOp) => Promise<void>
  onUpdateAvailable: (cb: () => void) => void
  onUpdateDownloaded: (cb: () => void) => void
  installUpdate: () => void
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
- Standalone connection windows receive JWT via route param (`/connection/terminal/:sessionId/:token`)
- `UpdateBanner` component listens for auto-update events and shows install prompt

### 4.4 Express.js Backend (`backend/src/`)

- Bound to `127.0.0.1:{port}` — not `0.0.0.0`
- Maintains an in-memory session pool: `Map<sessionId, ssh2.Client>`
- `ws` WebSocket server shares the same `http.Server` instance
- SSE endpoints (`text/event-stream`) stream SFTP transfer progress — no polling
- `requireAuthFlexible` middleware accepts JWT from query param (needed for `EventSource` which cannot set headers)
- Prisma handles all SQLite reads/writes; WAL mode enabled on startup
- Rate limiting: 5 auth attempts/min, 300 API requests/min

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
User clicks Upload in SFTP pane
  → Axios POST multipart to /api/sftp/:sessionId/upload
      Body: { transferId, remotePath } + file stream
    → Express controller → sftp.service.uploadFile(localPath, remotePath)
      → ssh2-sftp-client streams file chunks to remote server
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
│   │   └── index.ts                      # Window creation, backend spawn, IPC, tray, updater
│   │
│   ├── preload/                          # Preload Script
│   │   └── index.ts                      # contextBridge → window.api
│   │
│   └── renderer/                         # React Frontend (Vite)
│       ├── index.html                    # Vite HTML entry
│       └── src/
│           ├── main.tsx                  # React root — QueryClient + Router
│           ├── App.tsx                   # Root layout + auth state machine
│           │
│           ├── pages/
│           │   ├── Home.tsx              # Profile grid / dashboard
│           │   ├── Terminal.tsx          # Standalone terminal window wrapper
│           │   ├── Keys.tsx              # SSH key management
│           │   ├── Logs.tsx              # Audit log viewer
│           │   ├── Settings.tsx          # App settings (theme, font, lock, retention)
│           │   ├── LockScreen.tsx        # Master password prompt
│           │   └── SetupWizard.tsx       # First-run master password setup
│           │
│           ├── components/
│           │   ├── terminal/
│           │   │   ├── TerminalPane.tsx          # xterm.js wrapper + WS lifecycle
│           │   │   └── TabBar.tsx                # Multi-session tab strip (DnD)
│           │   ├── sftp/
│           │   │   ├── SftpPane.tsx              # Dual-pane SFTP explorer
│           │   │   └── LocalFilePane.tsx          # Local filesystem pane
│           │   ├── profiles/
│           │   │   ├── ProfileDetailPane.tsx     # Profile detail + connect + tunnels
│           │   │   └── ProfileForm.tsx            # Create / edit modal
│           │   ├── keys/
│           │   │   ├── KeyGeneratorModal.tsx      # RSA / ED25519 generator
│           │   │   └── KeyImportModal.tsx         # PEM / OpenSSH import
│           │   ├── layout/
│           │   │   ├── Sidebar.tsx
│           │   │   ├── TitleBar.tsx              # Custom Electron titlebar
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
│           ├── lib/
│           │   ├── api.ts                        # Axios instance + JWT interceptor
│           │   └── utils.ts                      # cn() helper + misc utilities
│           │
│           └── types/
│               └── index.ts                      # Shared frontend TypeScript types
│
├── backend/
│   └── src/
│       ├── index.ts                      # Server bootstrap (Express + ws + rate limit)
│       ├── routes/
│       │   ├── auth.routes.ts            # /api/auth/*
│       │   ├── profile.routes.ts         # /api/profiles/*
│       │   ├── session.routes.ts         # /api/sessions/*
│       │   ├── sftp.routes.ts            # /api/sftp/*
│       │   ├── key.routes.ts             # /api/keys/*
│       │   ├── tunnel.routes.ts          # /api/sessions/:id/tunnels (start/stop)
│       │   ├── audit.routes.ts           # /api/logs/*
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
│       │   ├── ssh.service.ts            # SSH session pool, connect/disconnect
│       │   ├── sftp.service.ts           # SFTP file operations + progress emitter
│       │   ├── key.service.ts            # Key generation, import, fingerprint
│       │   ├── tunnel.service.ts         # Port forwarding tunnel lifecycle
│       │   ├── crypto.service.ts         # AES-256-GCM + PBKDF2
│       │   ├── audit.service.ts          # Event logging + CSV export
│       │   └── config.service.ts         # App config CRUD (singleton row)
│       ├── websocket/
│       │   └── terminal.ws.ts            # WS handler — xterm.js ↔ ssh2 bridge
│       ├── middleware/
│       │   ├── auth.middleware.ts        # JWT verification (header + query param)
│       │   └── rateLimit.middleware.ts
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       └── config/
│           ├── db.ts                     # initDatabase() — migrate + WAL + connect
│           └── env.ts                    # Port, DATABASE_URL, JWT_SECRET
│
├── resources/                            # App icons
│   ├── icon.png
│   ├── icon.icns
│   └── icon.ico
├── build/                                # electron-builder resources
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

**Priority:** High | **Status:** ✅ Implemented

- FR-01.1 — Profile fields: Name, Host, Port (default 22), Username, Auth method (Password / SSH Key / Key + Passphrase)
- FR-01.2 — Home page shows profile cards: name, host, group tag, last connected time
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
- FR-01.8.4 — On save, the form issues `PUT /api/profiles/:id` with only the changed fields ✅
- FR-01.8.5 — On successful save, TanStack Query caches for `['profiles']` and `['profile', profileId]` are invalidated so all views reflect the update immediately ✅
- FR-01.8.6 — If the profile's `authMethod` changes (e.g. from Password to SSH Key), the form clears the irrelevant credential fields before submitting ✅
- FR-01.8.7 — Form validation mirrors the create flow: Name, Host, Port, and Username are required; Port must be 1–65535 ✅

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
| Backend route      | `backend/src/routes/profiles.routes.ts`                      | `PUT /api/profiles/:id` already exists — no change required                                                  |
| Backend controller | `backend/src/controllers/profiles.controller.ts`             | Verify partial-update (PATCH-style) is handled correctly; encrypted fields must re-encrypt on change         |

#### Out of Scope

- Editing a profile that is currently connected — the edit form may be opened but the running session is unaffected until next connect
- Bulk-editing multiple profiles at once
- Renaming a profile group/tag directly from the edit form (tag editing follows existing FR-01.6 flow)

---

### FR-02: SSH Terminal

**Priority:** High | **Status:** ✅ Implemented

- FR-02.1 — Connecting opens a Profile Details tab; users spawn standalone terminal console windows from it ✅
- FR-02.2 — xterm.js renders with full ANSI colour and escape sequence support ✅
- FR-02.3 — PTY resizes dynamically when the standalone window resizes (`xterm-addon-fit`) ✅
- FR-02.4 — Copy (Ctrl+Shift+C) supported; right-click paste **not yet implemented** ⚠️
- FR-02.5 — Full keyboard support: Ctrl+C, Ctrl+Z, Tab, arrow keys, function keys ✅
- FR-02.6 — Auto-reconnect on drop: exponential backoff (1s → 2s → 4s), max 3 retries; backend defers session cleanup for 15s to allow reconnect ✅
- FR-02.7 — Connection status badge: connected / reconnecting / disconnected ✅
- FR-02.8 — Closing standalone terminal window closes the backend PTY session ✅
- FR-02.9 — JWT token passed via route parameter — no re-auth required in popup windows ✅
- FR-02.10 — Terminal font, font size, and color theme customizable ✅
- FR-02.11 — Selecting text in the terminal automatically copies it to the system clipboard ✅

---

### FR-03: Multi-Tab Dashboard & Window Sessions

**Priority:** High | **Status:** ✅ Implemented

- FR-03.1 — Persistent "Home" anchor tab + dynamic Profile Detail tabs ✅
- FR-03.2 — Opening a saved profile spawns a dedicated Profile Details tab ✅
- FR-03.3 — Tabs can be switched; drag-to-reorder via `@hello-pangea/dnd` ✅
- FR-03.4 — Multiple concurrent Terminal and SFTP windows per profile tab ✅
- FR-03.5 — Active tabs keep SSH session pools alive in the Express backend ✅

---

### FR-04: SFTP File Manager

**Priority:** High | **Status:** ✅ Mostly Implemented (FR-04.6, FR-04.8 — see §17)

- FR-04.1 — SFTP Explorer opens in standalone window from Profile Details tab ✅
- FR-04.2 — Left pane: local machine files; Right pane: remote server files ✅
- FR-04.3 — Navigate by double-clicking folders ✅
- FR-04.4 — Upload: Upload button (native file dialog) + drag-and-drop ✅
- FR-04.5 — Download: Download button (native save dialog) ✅
- FR-04.6 — Rename in-place via right-click menu ✅; **F2 keyboard shortcut not yet implemented** ⚠️
- FR-04.7 — Delete with confirmation ✅
- FR-04.8 — Create new folder via button ✅; **Ctrl+Shift+N shortcut not yet implemented** ⚠️
- FR-04.9 — Show and edit Unix permissions (chmod) ✅
- FR-04.10 — Per-transfer progress via SSE: filename, bytes, %, speed + elapsed computed from progress deltas ✅
- FR-04.11 — Multiple simultaneous transfers in a queue; each has its own SSE stream ✅
- FR-04.12 — Transfer history: completed, active, and failed ✅
- FR-04.13 — Failed transfers: one-click retry with error reason shown ✅
- FR-04.14 — Toggle hidden files (dotfiles) ✅
- FR-04.15 — Breadcrumb path bar in both panes with click-to-navigate ✅
- FR-04.16 — Cancel an in-progress transfer ✅

---

### FR-05: SSH Key Management

**Priority:** High | **Status:** ✅ Mostly Implemented (FR-05.11 partial — see §17)

- FR-05.1 — Generate RSA (2048 / 4096-bit) and ED25519 keypairs ✅
- FR-05.2 — Import PEM format private keys via file picker ✅
- FR-05.3 — Import OpenSSH format private keys ✅
- FR-05.4 — Import PuTTY PPK keys — auto-converted to OpenSSH via sshpk ✅
- FR-05.5 — All private keys AES-256-GCM encrypted in SQLite ✅
- FR-05.6 — Optional passphrase protection per stored key ✅
- FR-05.7 — SHA-256 fingerprint and key type displayed per key ✅
- FR-05.8 — Copy public key to clipboard with one click ✅
- FR-05.9 — Export public key to file via native save dialog ✅
- FR-05.10 — Assign stored keys to profiles via the profile form ✅
- FR-05.11 — Delete key with confirmation ✅; **warning if key is in use by a profile not yet implemented** ⚠️
- FR-05.12 — Name and optional description per key ✅

---

### FR-06: Port Forwarding (Tunnels)

**Priority:** High | **Status:** ✅ Mostly Implemented (FR-06.6 — see §17)

- FR-06.1 — Local forwarding: `localhost:localPort → remoteHost:remotePort` ✅
- FR-06.2 — Remote forwarding: `remoteHost:remotePort → localhost:localPort` ✅
- FR-06.3 — Dynamic SOCKS5 proxy ✅
- FR-06.4 — Tunnel panel displayed inline inside Profile Details tab ✅
- FR-06.5 — Start/stop individual tunnels without interrupting terminal/SFTP windows ✅
- FR-06.6 — Port conflict detection before binding — **not yet implemented** ❌

---

### FR-07: Application Lock

**Priority:** Medium | **Status:** ✅ Fully Implemented

- FR-07.1 — First-run setup wizard: set master password or skip ✅
- FR-07.2 — Lock screen shown on app open if lock is enabled ✅
- FR-07.3 — Master password hashed with bcrypt (cost 12) ✅
- FR-07.4 — PBKDF2-SHA512 derives AES key from master password at unlock — memory only ✅
- FR-07.5 — Auto-lock after configurable idle timeout (default 15 minutes) ✅
- FR-07.6 — Lost master password = all encrypted data permanently unrecoverable — shown prominently ✅

---

### FR-08: Audit Logs

**Priority:** Medium | **Status:** ✅ Mostly Implemented (FR-08.2, FR-08.7 partial — see §17)

- FR-08.1 — Log: SSH connect (profile, host, timestamp, success/fail, error message) ✅
- FR-08.2 — Log: SSH disconnect with duration — **disconnect reason (user / timeout / error) not yet captured** ⚠️
- FR-08.3 — Log: SFTP upload (filename, size, remote path, timestamp, success/fail) ✅
- FR-08.4 — Log: SFTP download (filename, size, local path, timestamp) ✅
- FR-08.5 — Paginated log table with search and date range filter ✅
- FR-08.6 — Export logs as CSV via native save dialog ✅
- FR-08.7 — Auto-purge logs older than N days — config field present; **background purge trigger not yet verified** ⚠️

---

### FR-09: Profile Export/Import

**Priority:** Medium | **Status:** ✅ Implemented

Export and import connection profiles as JSON files for backup, sharing, and migration. SSH key material is intentionally excluded from profile exports — keys are managed separately via FR-10.

- FR-09.1 — Export selected profiles or all profiles as a `.json` file via native save dialog ✅
- FR-09.2 — Exported JSON includes all profile metadata: `name`, `host`, `port`, `username`, `authMethod`, `group`, `description`, and port-forwarding rules ✅
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

| Layer              | File(s)                                                        | Change needed                                                          |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Backend route      | `backend/src/routes/profiles.routes.ts`                        | `GET /api/profiles/export`, `POST /api/profiles/import`                |
| Backend controller | `backend/src/controllers/profiles.controller.ts`               | `exportProfiles`, `importProfiles` handlers                            |
| Backend service    | `backend/src/services/profiles.service.ts`                     | `buildExportPayload`, `applyImport` — strip sensitive fields on export |
| IPC                | `src/preload/index.ts` + `src/preload/index.d.ts`              | Expose `showSaveDialog` and `showOpenDialog` for `.json` files         |
| Frontend component | `src/renderer/src/pages/HomePage.tsx` or new `ProfilesToolbar` | Export All / Import buttons                                            |
| Frontend component | `src/renderer/src/components/ImportConflictDialog.tsx`         | New — Skip / Rename / Overwrite per-profile UI                         |
| API client         | `src/renderer/src/lib/api.ts`                                  | `exportProfiles(ids?)`, `importProfiles(data)`                         |

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
- FR-10.5 — On import, user is prompted for the export passphrase; the private key is unwrapped, then immediately re-encrypted with the current app master key and stored in the database — the export passphrase is not retained ✅
- FR-10.6 — On import conflict (key name already exists), the user is shown: **Skip**, **Rename** (append suffix), or **Overwrite** ✅
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

| Layer              | File(s)                                           | Change needed                                                                                             |
| ------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Backend route      | `backend/src/routes/keys.routes.ts`               | `GET /api/keys/:id/export`, `POST /api/keys/import`                                                       |
| Backend controller | `backend/src/controllers/keys.controller.ts`      | `exportKey`, `importKey` handlers                                                                         |
| Backend service    | `backend/src/services/keys.service.ts`            | `buildKeyBundle` (re-encrypt with passphrase), `applyKeyImport` (unwrap + re-encrypt with master key)     |
| Crypto service     | `backend/src/services/crypto.service.ts`          | Add `derivePassphraseKey(passphrase, salt)` and `encryptWithPassphrase` / `decryptWithPassphrase` helpers |
| IPC                | `src/preload/index.ts` + `src/preload/index.d.ts` | Expose `showSaveDialog` and `showOpenDialog` for `.cskb` files (reuse if already added for FR-09)         |
| Frontend component | `src/renderer/src/components/ExportKeyDialog.tsx` | New — passphrase + confirm input before export                                                            |
| Frontend component | `src/renderer/src/components/ImportKeyDialog.tsx` | New — file picker + passphrase input for import                                                           |
| API client         | `src/renderer/src/lib/api.ts`                     | `exportKey(id, passphrase)`, `importKey(bundle, passphrase)`                                              |

**Out of Scope:**

- Exporting raw private key as PEM/OpenSSH without passphrase protection — this FR always wraps with a passphrase
- Batch export of multiple keys in a single file — one key per `.cskb` file
- Importing raw PEM/OpenSSH/PPK files — that is FR-05.2–FR-05.4

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

### NFR-02: Security

- All passwords, passphrases, private keys AES-256-GCM encrypted before DB write
- AES key derived at runtime from master password via PBKDF2-SHA512 — never persisted
- Private key material never sent across IPC bridge to renderer
- Express bound to `127.0.0.1` only — never `0.0.0.0`
- JWT expires after 8 hours, re-issued on unlock
- All API inputs validated with zod before reaching controllers
- SFTP file paths sanitized server-side — no `..` traversal
- Context isolation enabled in Electron — renderer has no direct Node.js access

### NFR-03: Reliability

- SSH session errors are isolated per tab — one failure does not affect others
- Auto-reconnect: exponential backoff (1s → 2s → 4s), max 3 retries
- Electron main auto-restarts Express if it crashes unexpectedly
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
- Keyboard shortcuts adapted per OS via Electron accelerators

### NFR-06: Maintainability

- 100% TypeScript — renderer, backend, main, preload
- ESLint + Prettier enforced
- Business logic only in services — controllers are thin
- Prisma schema is the single source of truth for data shapes

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
  url      = env("DATABASE_URL")
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
  type          String              // "connection" | "sftp_upload" | "sftp_download" | "key_used"
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
GET   /api/auth/status    → { configured: boolean, locked: boolean }
POST  /api/auth/setup     → First run: set master password
POST  /api/auth/setup/skip → Skip password setup (run unlocked)
POST  /api/auth/unlock    → Verify master password → returns { token: string }
POST  /api/auth/lock      → Lock the app (clear active AES key)
```

### 9.3 Profiles API

```
GET    /api/profiles                  → List all profiles
POST   /api/profiles                  → Create profile
GET    /api/profiles/:id              → Get single profile
PUT    /api/profiles/:id              → Update profile
DELETE /api/profiles/:id              → Delete profile
POST   /api/profiles/:id/duplicate    → Duplicate profile → { id: string }
POST   /api/profiles/:id/connect      → Open SSH connection → { sessionId: string }
```

### 9.4 Sessions API

```
GET    /api/sessions                  → List active sessions
DELETE /api/sessions/:sessionId       → Disconnect session
```

### 9.5 WebSocket — Terminal

```
WS  ws://127.0.0.1:{port}/ws/terminal/:sessionId

Client → Server:
  { type: "input",  data: "<base64>" }
  { type: "resize", cols: 220, rows: 50 }
  { type: "ping" }

Server → Client:
  { type: "output", data: "<base64>" }
  { type: "status", state: "connected" | "reconnecting" | "disconnected" }
  { type: "error",  message: "Connection refused" }
  { type: "pong" }
```

### 9.6 SFTP API

```
GET    /api/sftp/:sessionId/list         ?path=/home/user  → File listing
POST   /api/sftp/:sessionId/upload                         → Upload (multipart) → { transferId }
POST   /api/sftp/:sessionId/download     { path }          → Download (binary stream)
POST   /api/sftp/:sessionId/delete       { path }          → Delete file/directory
POST   /api/sftp/:sessionId/rename       { oldPath, newPath } → Rename/move
POST   /api/sftp/:sessionId/mkdir        { path }          → Create directory
POST   /api/sftp/:sessionId/chmod        { path, mode }    → Change permissions
GET    /api/sftp/:sessionId/progress/:transferId           → SSE progress stream
```

> **Not yet implemented:** `DELETE /api/sftp/:sessionId/transfer/:transferId` — cancel in-progress transfer (see §17, BL-01)

### 9.6a SFTP Progress — SSE

```
GET  /api/sftp/:sessionId/progress/:transferId
     Content-Type: text/event-stream
     Cache-Control: no-cache

Event stream:
  data: { "transferId": "t_abc", "status": "progress",
          "bytesTransferred": 524288, "totalBytes": 2097152,
          "percent": 25, "speedBytesPerSec": 1048576, "elapsedMs": 500 }

  data: { "transferId": "t_abc", "status": "complete",
          "bytesTransferred": 2097152, "totalBytes": 2097152,
          "percent": 100, "elapsedMs": 1900 }

  data: { "transferId": "t_abc", "status": "error",
          "message": "Permission denied", "bytesTransferred": 524288 }
  [stream closes]
```

### 9.7 SSH Keys API

```
GET    /api/keys              → List keys (no private key material in response)
POST   /api/keys/generate     → Generate RSA or ED25519 keypair
POST   /api/keys/import       → Import PEM / OpenSSH key
DELETE /api/keys/:id          → Delete key
```

### 9.8 Tunnels API

```
POST   /api/sessions/:sessionId/start    → Start local/remote/dynamic tunnel
POST   /api/sessions/:sessionId/stop     → Stop a tunnel
```

### 9.9 Audit Logs API

```
GET    /api/logs    ?type=&from=&to=&page=   → Paginated + filtered logs
GET    /api/logs/export                       → CSV download
```

> **Not yet implemented:** `DELETE /api/logs` — clear all logs (see §17, BL-06)

### 9.10 App Config API

```
GET    /api/config    → Get app config (theme, font, lock settings, retention)
PUT    /api/config    → Update app config
```

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

- All request bodies validated with `zod` schemas in Express middleware
- SSH hostnames validated against RFC 1123
- Ports validated (1–65535)
- SFTP remote paths sanitized — `..` traversal rejected

### 10.7 Electron Security

- `contextIsolation: true` — renderer has no direct Node.js access
- `nodeIntegration: false` in renderer
- All Node.js APIs exposed only via typed `contextBridge` surface
- Standalone connection windows pass JWT via route parameter — no credential storage in window state

---

## 11. UI/UX Requirements

### 11.1 Application Layout

```
┌──────────────────────────────────────────────────────────┐
│  ● ● ●   CypherShell                      [_]  [□]  [X] │  ← Custom Electron TitleBar
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
- **Light**: `#ffffff` bg, `#111827` text
- **System**: follows OS preference (`prefers-color-scheme`)
- **Terminal schemes** (6 options): Default Dark, Dracula, Nord, Solarized Dark, Monokai, One Dark

### 11.3 Typography

- UI font: system font stack (SF Pro / Segoe UI / Ubuntu)
- Terminal font: JetBrains Mono — bundled as a local font asset, not fetched from CDN
- Terminal font size: 10–24px, configurable in Settings

### 11.4 Required UI States

| State   | Treatment                                      |
| ------- | ---------------------------------------------- |
| Loading | Skeleton screen or spinner — never blank white |
| Empty   | Empty state with clear call-to-action          |
| Error   | Red toast + inline message + retry button      |
| Success | Green toast, auto-dismiss after 3 seconds      |

### 11.5 shadcn/ui Components Used

`Button`, `Input`, `Textarea`, `Dialog`, `Sheet`, `Tabs`, `Table`, `Badge`, `Tooltip`, `DropdownMenu`, `Select`, `ScrollArea`, `Separator`, `Progress`, `Skeleton`, `Sonner` (toasts)

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
zod
sonner                         Toast notifications
react-dropzone                 Drag-and-drop file upload (SFTP)
@hello-pangea/dnd              Tab drag-to-reorder
```

### Backend

```
express                   v4
cors
ws                             WebSocket server
ssh2                           SSH client
ssh2-sftp-client               SFTP operations
@prisma/client                 ORM client
better-sqlite3                 SQLite native driver (used by Prisma)
bcrypt                         Master password hashing
jsonwebtoken                   JWT
zod                            Request body validation
express-rate-limit             Rate limiting
multer                         Multipart file upload (SFTP upload endpoint)
node-forge                     RSA/ED25519 keypair generation
sshpk                          PPK → OpenSSH key conversion
portfinder                     Auto-select free localhost port
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

| Risk                                                | Impact     | Mitigation                                                                                                                                        |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssh2` failures on unusual SSH server configs       | Medium     | Wrap all connections in try/catch; expose raw error in UI                                                                                         |
| xterm.js perf with very high output (log tail)      | Medium     | Enable WebGL renderer addon; implement output throttling                                                                                          |
| PPK import accuracy across PPK format versions      | Low–Medium | Test with real PuTTY PPK v2/v3 files; sshpk handles both                                                                                          |
| `better-sqlite3` native binary bundling in Electron | Medium     | `after-pack.cjs` rebuilds the `.node` binary against Electron's ABI in the staging area; `bindings` + `file-uri-to-path` ship as `extraResources` |
| SQLite corruption on OS force-kill                  | Low        | WAL mode enabled on DB init                                                                                                                       |
| Prisma engine binary missing in packaged app        | Medium     | Resolved — `binaryTargets = ["native"]` only; Prisma CLI not shipped; migrations applied via `better-sqlite3` at startup                          |
| Electron bundle > 200MB                             | Resolved   | esbuild bundles backend pure-JS deps inline; installer is ~101 MB                                                                                 |
| Windows SFTP path separator issues                  | Medium     | Always use `path.posix` for remote paths                                                                                                          |
| Port collision on backend auto-assign               | Low        | `portfinder` scans from 4000 upward                                                                                                               |

---

## 16. Implementation Status

Current build state as of v3.0 of this document.

| Module                     | Status      | Notes                                                                                        |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| Electron main process      | ✅ Complete | portfinder, backend spawn, IPC, auto-updater, app.log                                        |
| Preload / contextBridge    | ✅ Complete | Full typed window.api surface                                                                |
| App auth state machine     | ✅ Complete | loading → setup/locked/unlocked flow                                                         |
| SetupWizard page           | ✅ Complete | First-run master password setup                                                              |
| LockScreen page            | ✅ Complete | Unlock with bcrypt verify + JWT                                                              |
| Home page / Profile grid   | ✅ Complete | Search, filter, CRUD, duplicate, export/import                                               |
| ProfileDetailPane          | ✅ Complete | Connect/disconnect, tunnel panel, window spawning                                            |
| ProfileForm                | ✅ Complete | Create/edit with key selector                                                                |
| TerminalPane (xterm.js)    | ✅ Complete | WebSocket I/O, resize, themes, search                                                        |
| TabBar                     | ✅ Complete | DnD reorder, close, Home anchor tab                                                          |
| SftpPane (dual-pane)       | ✅ Complete | All file ops, progress, transfer queue                                                       |
| LocalFilePane              | ✅ Complete | Local FS browsing via Electron IPC                                                           |
| Keys page                  | ✅ Complete | Generate, import, copy, export, delete, export/import .cskb bundle                           |
| Logs page                  | ✅ Complete | Filter, search, date range, CSV export                                                       |
| Settings page              | ✅ Complete | Theme, font, lock, retention                                                                 |
| UpdateBanner               | ✅ Complete | Auto-update notification + install                                                           |
| SSH service                | ✅ Complete | Session pool, password + key auth                                                            |
| SFTP service               | ✅ Complete | All file ops + SSE progress emitter                                                          |
| Crypto service             | ✅ Complete | AES-256-GCM + PBKDF2 (master key + passphrase-based)                                         |
| Key service                | ✅ Complete | RSA/ED25519 gen, import, fingerprint, .cskb export/import                                    |
| Tunnel service             | ✅ Complete | Local, remote, dynamic SOCKS5                                                                |
| Audit service              | ✅ Complete | Event logging + CSV generation                                                               |
| Config service             | ✅ Complete | AppConfig singleton CRUD                                                                     |
| Profile service            | ✅ Complete | Export payload builder, conflict check, import with resolution                               |
| WebSocket terminal handler | ✅ Complete | Bidirectional base64 SSH I/O                                                                 |
| Auth middleware            | ✅ Complete | JWT + query-param fallback for SSE                                                           |
| Rate limiting              | ✅ Complete | 5/min auth, 300/min API                                                                      |
| Database schema            | ✅ Complete | 5 models, Prisma migrations, WAL mode                                                        |
| Build pipeline             | ✅ Complete | Win/Mac/Linux installers; Windows installer ~101 MB (esbuild + migration-via-better-sqlite3) |

---

## 17. v1.1 Backlog — Unimplemented Requirements

These items are specified in this SRS but have not yet been implemented. They are the target scope for the v1.1 release.

---

### ~~BL-01 — Cancel In-Progress SFTP Transfer~~ ✅ Implemented

**Requirement:** FR-04.16
**Priority:** High — **Done in v1.1**

Implemented: `DELETE /api/sftp/:sessionId/transfer/:transferId` → `SftpService.cancelTransfer()` destroys the underlying ssh2 SFTPStream, emits `{ status: 'cancelled' }` on the SSE channel, and cleans up the `activeTransfers` Map. The `SftpPane` cancel button calls the endpoint and the `transferStore` reflects the cancelled state immediately.

---

### BL-02 — Port Conflict Detection

**Requirement:** FR-06.6
**Priority:** Medium

Before binding a local port for a tunnel, check if the port is already in use. If so, show a warning dialog with the port number and the tunnel label.

**Backend work:** In `TunnelService.startForward()`, use `portfinder` or a manual `net.createServer` probe to check if `localPort` is already bound. Return a structured error `{ code: 'PORT_IN_USE', port: number }` if so.
**Frontend work:** In `ProfileDetailPane`, catch this error and display a clear warning before failing.

---

### BL-03 — In-Use Key Delete Warning

**Requirement:** FR-05.11
**Priority:** Medium

When a user attempts to delete an SSH key, check if any profiles reference that key. If yes, show a warning listing the affected profile names before confirming the deletion.

**Backend work:** In `KeyController.deleteKey()`, query `Profile.findMany({ where: { sshKeyId: id } })` before deleting. Return the list of affected profile names in the response if `profiles.length > 0`.
**Frontend work:** In `Keys.tsx`, handle this response by showing a confirmation dialog that lists affected profiles with a clear warning that those profiles will lose their key assignment.

---

### BL-04 — Audit Log Auto-Purge

**Requirement:** FR-08.7
**Priority:** Medium

The `AppConfig.logRetentionDays` field exists, but no scheduled task runs to purge logs older than that value.

**Backend work:** In `initDatabase()` (or as a startup task in `backend/src/index.ts`), after DB initialization, call `AuditService.purgeOldLogs()` which deletes records where `timestamp < now - retentionDays`. Schedule this to also run once every 24 hours using `setInterval`.

---

### BL-05 — SSH Disconnect Reason Logging

**Requirement:** FR-08.2
**Priority:** Low

Currently, SSH disconnect events may not distinguish between user-initiated disconnect, idle timeout, and unexpected connection drop.

**Backend work:** In `SshService`, capture the `ssh2` `close` event reason. Pass `disconnectReason: 'user' | 'timeout' | 'error'` to `AuditService.logEvent()`. Store it in `AuditLog.detail` or add a dedicated column.

---

### BL-06 — Clear All Logs Endpoint

**Requirement:** §9.9 (API design)
**Priority:** Low

`DELETE /api/logs` to clear all audit logs is in the API specification but not yet implemented.

**Backend work:** Add route + controller + `AuditService.clearAllLogs()` method (which calls `prisma.auditLog.deleteMany({})`).
**Frontend work:** Add a "Clear All Logs" button in `Logs.tsx` with a confirmation dialog. Wire to `DELETE /api/logs`.

---

### BL-07 — SFTP Keyboard Shortcuts

**Requirements:** FR-04.6 (F2 rename), FR-04.8 (Ctrl+Shift+N new folder)
**Priority:** Low

The file operations exist via right-click and buttons, but the following keyboard shortcuts are missing from `SftpPane.tsx`:

- **F2** — trigger rename on the currently selected file
- **Ctrl+Shift+N** — open the new folder dialog

**Frontend work:** Add `keydown` event listeners to `SftpPane.tsx` that fire the corresponding handlers when the remote pane is focused. Track selected file in component state for F2 target.

---

### BL-08 — Terminal Right-Click Paste

**Requirement:** FR-02.4
**Priority:** Low

`Ctrl+Shift+C` (copy) works via xterm.js default behaviour, but right-click paste is not implemented.

**Frontend work:** In `TerminalPane.tsx`, add a `contextmenu` event listener on the xterm container that reads `navigator.clipboard.readText()` and writes the result to the terminal via `socket.send({ type: 'input', data: text })`.

---

### BL-09 — Terminal Auto-Copy on Selection ✅

**Requirement:** FR-02.11
**Priority:** Medium

Selecting text in the terminal does not automatically copy to the system clipboard. Users must manually press `Ctrl+Shift+C` after selecting, which differs from the standard Unix/Linux terminal behaviour where selection = copy.

**Requirements:**

- FR-02.11.1 — Click-and-drag (mouse) selection in the terminal automatically copies the selected text to the system clipboard on mouse release ❌
- FR-02.11.2 — Double-click (word) and triple-click (line) selection also trigger auto-copy ❌
- FR-02.11.3 — An empty or cleared selection does not overwrite the clipboard with an empty string ❌

**Acceptance Criteria:**

- [ ] Dragging to select text copies to OS clipboard immediately — verified by pasting outside the app
- [ ] Double-clicking a word and triple-clicking a line each copy to clipboard
- [ ] Clearing a selection (clicking blank area) does not wipe the clipboard
- [ ] `Ctrl+Shift+C` shortcut (FR-02.4) continues to work as before
- [ ] Auto-copy works in all terminal themes and font size settings

**Frontend work:** In `src/renderer/src/components/terminal/TerminalPane.tsx`, listen to `terminal.onSelectionChange()` (xterm.js API). In the handler, check `terminal.hasSelection()` and if truthy, call `navigator.clipboard.writeText(terminal.getSelection())`. No backend or IPC changes are needed.

---

_End of SRS Document — v3.0_
