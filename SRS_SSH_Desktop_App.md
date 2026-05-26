# Software Requirements Specification (SRS)
## SSH Desktop Client — Bitvise-Like Application
**Version:** 2.0
**Author:** Athul T S
**Date:** 2026-05-18
**Status:** Draft

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

---

## 1. Introduction

### 1.1 Purpose

This document defines the complete software requirements for a desktop SSH client application — a modern alternative to Bitvise SSH Client — built using electron-vite, React, TypeScript, Tailwind CSS, shadcn/ui, and a local Express.js backend. It is the single source of truth for all development, architecture decisions, and feature scope.

### 1.2 Project Goal

Build a cross-platform desktop SSH client that allows users to:
- Connect to remote servers via SSH
- Manage files via SFTP
- Forward ports (local, remote, dynamic SOCKS5)
- Manage SSH keys (generate, import, store securely)
- Maintain multiple concurrent sessions in tabs
- Save and reuse connection profiles securely

### 1.3 Why This Stack (Not Next.js)

Next.js was considered and rejected. All of its primary value — SSR, Server Components, Server Actions, API Routes, Image Optimization — is completely useless inside an Electron shell. Using Next.js in Electron means paying the full weight and complexity cost of a web framework while using it as nothing more than a plain React SPA.

`electron-vite` is the community-standard build toolchain for Electron + React desktop apps. It handles main process, preload scripts, and renderer (React + Vite) in a single unified config — purpose-built for exactly this use case.

### 1.4 Definitions & Acronyms

| Term | Meaning |
|------|---------|
| SSH | Secure Shell Protocol |
| SFTP | SSH File Transfer Protocol |
| SRS | Software Requirements Specification |
| IPC | Inter-Process Communication (Electron main ↔ renderer) |
| PTY | Pseudo-terminal — required for interactive SSH shell |
| xterm.js | In-browser terminal emulator library (used by VS Code) |
| ssh2 | Node.js SSH client library |
| AES-256-GCM | Advanced Encryption Standard, 256-bit Galois/Counter Mode |
| JWT | JSON Web Token |
| electron-vite | Build tool for Electron apps using Vite as the bundler |
| Prisma | Type-safe ORM with auto-generated TypeScript client |
| shadcn/ui | Copy-owned Radix UI primitives styled with Tailwind CSS |

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
        ↓ WebSocket (SSH terminal) / REST (everything else)
[Local Express.js server — spawned by Electron main on localhost]
        ↓ ssh2
[Remote Linux/Unix Servers via SSH Protocol]
```

No external servers. No cloud. No installation of dependencies by the end user.

### 2.2 User Class

**Solo Developer / DevOps Engineer / System Administrator**
A technically proficient user who manages remote Linux/Unix servers and wants a polished GUI alternative to PuTTY, MobaXterm, or Bitvise — without being forced to the CLI for file transfers, key management, or tunnel configuration.

### 2.3 Operating Environment

| Item | Detail |
|------|--------|
| OS | Windows 10+, macOS 12+, Ubuntu 20.04+ |
| Architecture | x64, ARM64 (Apple Silicon) |
| Runtime | Node.js 20+ bundled inside Electron — user installs nothing |
| Electron | v30+ |
| Minimum RAM | 512MB |
| Disk space | ~200MB installed |
| Network | Active connection to target SSH servers |
| Local DB | SQLite — single `.db` file in OS user data directory, auto-created |

### 2.4 Assumptions

- The user understands basic SSH concepts (host, port, username, keys)
- The app is for personal or small-team use — not SaaS
- The Express backend runs on an auto-assigned localhost port, chosen at startup
- The SQLite `.db` file lives in `app.getPath('userData')` — no setup or install needed
- Private keys and passwords are never stored unencrypted anywhere on disk

---

## 3. Tech Stack Decision

### 3.1 Final Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop Shell | Electron 30+ | Full OS access — native FS, SSH key storage, system tray, native dialogs |
| Build Toolchain | electron-vite | Purpose-built for Electron + React. Unified config for main, preload, renderer. HMR in dev |
| Frontend | React 18 + TypeScript | Component model, hooks, full type safety |
| Styling | Tailwind CSS v3 | Utility-first, no runtime overhead |
| UI Components | shadcn/ui | Accessible Radix primitives styled with Tailwind. Copy-owned — no version lock |
| Client Routing | React Router v6 | Simple SPA routing — HashRouter for Electron file:// compat |
| Terminal | xterm.js | Industry-standard in-browser terminal emulator (same as VS Code) |
| State Management | Zustand | Minimal boilerplate, no Provider nesting, perfect for solo dev |
| Data Fetching | TanStack Query v5 | Async state, caching, retry, loading/error handling |
| HTTP Client | Axios | JWT interceptor, base URL from preload port |
| Backend | Express.js + TypeScript | Simple, fast, full Node.js runtime for native modules |
| SSH | ssh2 | Most popular Node.js SSH library, actively maintained |
| SFTP | ssh2-sftp-client | Wraps ssh2 for clean SFTP operations |
| WebSocket | ws | Lightweight WebSocket server for SSH terminal I/O streaming |
| Database | SQLite + Prisma | Zero install, single file DB, full auto-generated TS types |
| Password Hashing | bcrypt | Master password hashing (cost factor 12) |
| Auth Tokens | jsonwebtoken | Short-lived JWT between renderer and local Express |
| Encryption | Node.js `crypto` (built-in) | AES-256-GCM for all secrets at rest |
| Key Derivation | PBKDF2 via `crypto` (built-in) | Derives AES key from master password at unlock |
| Validation | zod | Runtime schema validation on all API inputs |
| Key Generation | node-forge | RSA/ED25519 keypair generation |
| PPK Conversion | sshpk | PuTTY PPK → OpenSSH conversion |
| Port Discovery | portfinder | Auto-selects a free localhost port for Express on startup |

### 3.2 electron-vite vs Alternatives

| Concern | electron-vite | CRA / plain Webpack |
|---------|--------------|---------------------|
| Dev server startup | ~300ms | 5–15s |
| Hot Module Replacement | Native, instant | Slow or broken |
| Main + preload + renderer | Unified one config | Multiple separate configs |
| TypeScript | First-class | Requires setup |
| Output for Electron | Optimized (ESM) | Larger bundles |
| Community | Growing standard for Electron+React | Legacy |

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
│  │  │   Pages     │  │  Pages   │  │   Manager   │  │  │
│  │  └─────────────┘  └──────────┘  └─────────────┘  │  │
│  │                                                    │  │
│  │    xterm.js  │  Zustand  │  TanStack Query         │  │
│  └──────────────┬─────────────────────────────────────┘  │
│                 │ contextBridge IPC (window.api)          │
│  ┌──────────────▼──────────────┐                         │
│  │       Preload Script        │                         │
│  │  exposes: backendPort,      │                         │
│  │  openFileDialog, appVersion │                         │
│  └──────────────┬──────────────┘                         │
│                 │                                         │
│  ┌──────────────▼──────────────┐                         │
│  │       Main Process          │                         │
│  │  - portfinder → free port   │                         │
│  │  - sets DATABASE_URL        │                         │
│  │  - spawns Express backend   │                         │
│  │  - native file dialogs      │                         │
│  │  - system tray              │                         │
│  └──────────────┬──────────────┘                         │
│                 │ 127.0.0.1:{port}                        │
│  ┌──────────────▼──────────────────────────────────────┐ │
│  │              Express.js Backend                     │ │
│  │                                                     │ │
│  │   REST /api/*    WebSocket /ws    Prisma + SQLite   │ │
│  │                                  sshclient.db       │ │
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

- Uses `portfinder` to find a free localhost port
- Sets `process.env.DATABASE_URL = file:{userData}/sshclient.db`
- Spawns Express.js backend as a child process (env vars injected)
- Creates `BrowserWindow`, loads Vite renderer
- Passes backend port to preload via `webContents` or a dedicated IPC channel
- Handles: window lifecycle, system tray, native file dialogs via IPC
- Monitors Express child process — auto-restarts if it exits unexpectedly

### 4.2 Preload Script (`src/preload/index.ts`)

Runs in an isolated context with Node.js access. Exposes a safe `window.api` surface:

```typescript
interface ElectronAPI {
  backendPort: number;
  openFileDialog:      () => Promise<string[]>;
  openDirectoryDialog: () => Promise<string>;
  saveFileDialog:      (defaultName: string) => Promise<string | null>;
  appVersion:          string;
}
```

No raw Node.js or Electron APIs are exposed directly to the renderer.

### 4.3 Renderer — React SPA (`src/renderer/`)

- Pure React SPA, built and served by Vite
- Uses `createHashRouter` from React Router v6 — required for `file://` protocol
- Reads `window.api.backendPort` to build the base URL for all API calls
- REST via Axios (with JWT interceptor) for all CRUD and SFTP operations
- WebSocket via native `WebSocket` API for SSH terminal I/O
- **SSE via native `EventSource` API** for real-time SFTP transfer progress streaming
- Zustand manages global in-memory state: open sessions, tab order, transfer queue
- TanStack Query manages all server-state: profiles, keys, logs (caching + retry)

### 4.4 Express.js Backend (`backend/src/`)

- Bound to `127.0.0.1:{port}` — not `0.0.0.0`
- Maintains an in-memory session pool: `Map<sessionId, ssh2.Client>`
- `ws` WebSocket server shares the same `http.Server` instance
- **SSE endpoints** (`text/event-stream`) stream SFTP transfer progress to the renderer — no polling
- Prisma handles all SQLite reads/writes
- On startup: runs `prisma migrate deploy` then enables WAL mode

### 4.5 SSH Terminal Data Flow

```
User types in xterm.js
  → ws.send({ type: 'input', data: 'ls -la\r' })
    → Express WS handler → ssh2 stream.write(data)
      → Remote server processes command
        → ssh2 stream emits 'data' event
          → Express WS handler → ws.send({ type: 'output', data: '...' })
            → xterm.js terminal.write(data) → screen updates
```

### 4.6 SFTP Data Flow

```
User clicks Upload in SFTP page
  → Axios POST multipart to /api/sftp/:sessionId/upload
      Body: { transferId, remotePath } + file stream
    → Express controller → sftp.service.put(localPath, remotePath)
      → ssh2-sftp-client streams file chunks to remote server
        → On each chunk: sftp.service emits progress to an in-memory EventEmitter
          → SSE handler (GET /api/sftp/:sessionId/progress/:transferId)
              reads EventEmitter → writes "data: {...}\n\n" to response stream
            → Browser EventSource fires "message" event
              → transferStore.updateProgress(transferId, { bytes, percent, speed })
                → React re-renders progress bar

Download follows the same pattern in reverse:
  → GET /api/sftp/:sessionId/download?path=... streams file bytes as response body
  → Separate SSE stream on /api/sftp/:sessionId/progress/:transferId reports progress
  → On completion or error, SSE sends a final event and the stream closes
```

---

## 5. Folder Structure

```
ssh-desktop-client/
│
├── src/                                  # electron-vite source root
│   │
│   ├── main/                             # Electron Main Process
│   │   ├── index.ts                      # Window creation, backend spawn, tray
│   │   ├── backend-runner.ts             # Spawn/monitor Express child process
│   │   └── ipc-handlers.ts              # Native file dialog IPC handlers
│   │
│   ├── preload/                          # Preload Script
│   │   └── index.ts                      # contextBridge → window.api
│   │
│   └── renderer/                         # React Frontend (Vite)
│       ├── index.html                    # Vite HTML entry
│       └── src/
│           ├── main.tsx                  # React root — QueryClient + Router
│           ├── App.tsx                   # Root layout: sidebar, tab bar, outlet
│           │
│           ├── pages/
│           │   ├── Home.tsx              # Profile list / dashboard
│           │   ├── Terminal.tsx          # SSH terminal tab
│           │   ├── Sftp.tsx              # SFTP dual-pane file manager
│           │   ├── Keys.tsx              # SSH key management
│           │   ├── Logs.tsx              # Audit log viewer
│           │   ├── Settings.tsx          # App settings
│           │   └── LockScreen.tsx        # Master password prompt
│           │
│           ├── components/
│           │   ├── terminal/
│           │   │   ├── TerminalPane.tsx          # xterm.js wrapper
│           │   │   ├── TabBar.tsx                # Multi-session tab strip
│           │   │   └── ConnectionStatus.tsx      # Status dot (green/yellow/red)
│           │   ├── sftp/
│           │   │   ├── FilePane.tsx              # Single pane (local or remote)
│           │   │   ├── DualPaneLayout.tsx         # Left + right split view
│           │   │   ├── TransferQueue.tsx          # Active + completed transfers
│           │   │   └── PermissionBadge.tsx        # Unix chmod display + editor
│           │   ├── profiles/
│           │   │   ├── ProfileCard.tsx
│           │   │   ├── ProfileForm.tsx            # Create / edit modal
│           │   │   └── ProfileSearch.tsx
│           │   ├── keys/
│           │   │   ├── KeyList.tsx
│           │   │   ├── KeyGeneratorModal.tsx      # RSA / ED25519 generator
│           │   │   └── KeyImportModal.tsx         # PEM / PPK / OpenSSH import
│           │   ├── tunnels/
│           │   │   ├── TunnelPanel.tsx            # Active tunnels per session
│           │   │   └── TunnelForm.tsx             # Add / edit tunnel rule
│           │   ├── layout/
│           │   │   ├── Sidebar.tsx
│           │   │   ├── TitleBar.tsx              # Custom Electron titlebar
│           │   │   └── StatusBar.tsx
│           │   └── ui/                           # shadcn/ui (copy-owned)
│           │       ├── button.tsx
│           │       ├── dialog.tsx
│           │       ├── input.tsx
│           │       ├── table.tsx
│           │       ├── tabs.tsx
│           │       ├── progress.tsx
│           │       ├── skeleton.tsx
│           │       ├── badge.tsx
│           │       ├── tooltip.tsx
│           │       ├── dropdown-menu.tsx
│           │       ├── scroll-area.tsx
│           │       └── ...
│           │
│           ├── hooks/
│           │   ├── useSSHSession.ts              # Open / close sessions
│           │   ├── useWebSocket.ts               # WS lifecycle + reconnect
│           │   ├── useTerminalResize.ts          # PTY resize on window resize
│           │   ├── useSFTP.ts                    # SFTP queries via TanStack
│           │   ├── useProfiles.ts                # Profile CRUD via TanStack
│           │   └── useBackendURL.ts              # Reads window.api.backendPort
│           │
│           ├── store/
│           │   ├── sessionStore.ts               # Active SSH sessions (Zustand)
│           │   ├── tabStore.ts                   # Tab list, active tab, order
│           │   └── transferStore.ts              # SFTP transfer queue (Zustand)
│           │
│           ├── lib/
│           │   ├── api.ts                        # Axios instance + JWT interceptor
│           │   ├── wsClient.ts                   # WebSocket manager
│           │   └── utils.ts                      # cn() helper + misc utilities
│           │
│           └── types/
│               └── index.ts                      # Shared frontend TypeScript types
│
├── backend/                              # Express.js Backend
│   └── src/
│       ├── index.ts                      # Server bootstrap (Express + ws)
│       ├── routes/
│       │   ├── auth.routes.ts
│       │   ├── profile.routes.ts
│       │   ├── key.routes.ts
│       │   ├── sftp.routes.ts
│       │   ├── session.routes.ts
│       │   └── forward.routes.ts
│       ├── controllers/
│       │   ├── auth.controller.ts
│       │   ├── profile.controller.ts
│       │   ├── key.controller.ts
│       │   ├── sftp.controller.ts
│       │   ├── session.controller.ts
│       │   └── forward.controller.ts
│       ├── services/
│       │   ├── ssh.service.ts            # SSH session pool, connect/disconnect
│       │   ├── sftp.service.ts           # SFTP file operations
│       │   ├── key.service.ts            # Key generation, import, export
│       │   ├── forward.service.ts        # Port forwarding tunnel lifecycle
│       │   └── crypto.service.ts         # AES-256-GCM + PBKDF2
│       ├── websocket/
│       │   └── terminal.ws.ts            # WS handler — xterm.js ↔ ssh2 bridge
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── client.ts                 # Prisma singleton export
│       ├── middleware/
│       │   ├── auth.middleware.ts        # JWT verification
│       │   ├── rateLimit.middleware.ts
│       │   └── error.middleware.ts       # Global error handler
│       └── config/
│           ├── db.ts                     # initDatabase() — migrate + WAL + connect
│           └── env.ts                    # Port, DATABASE_URL, JWT_SECRET
│
├── resources/                            # App icons for packaging
│   ├── icon.png
│   ├── icon.icns
│   └── icon.ico
│
├── electron.vite.config.ts               # Unified electron-vite build config
├── electron-builder.yml                  # Packaging: exe / dmg / AppImage
├── package.json
├── tsconfig.json
├── tsconfig.node.json                    # Main + preload (Node.js target)
└── tsconfig.web.json                     # Renderer (Browser target)
```

---

## 6. Functional Requirements

### FR-01: Saved Connection Profiles

**Priority:** High
**Description:** Create, edit, duplicate, and delete saved SSH connection profiles.

- FR-01.1 — Profile fields: Name, Host, Port (default 22), Username, Auth method (Password / SSH Key / Key + Passphrase)
- FR-01.2 — Home page shows profile cards: name, host, group tag, last connected time, status badge
- FR-01.3 — Double-click or "Connect" button opens a new SSH terminal tab
- FR-01.4 — Stored in SQLite via Prisma; passwords/passphrases AES-256-GCM encrypted before write
- FR-01.5 — Profiles can be duplicated with one click
- FR-01.6 — Profiles can be tagged/grouped (e.g. "Production", "Staging")
- FR-01.7 — Real-time search and filter by name or host

---

### FR-02: SSH Terminal

**Priority:** High
**Description:** Interactive SSH shell session rendered in standalone windows using xterm.js.

- FR-02.1 — Connecting to a profile opens a dynamic Profile Details tab, from which users can spawn one or more independent standalone interactive SSH terminal console windows.
- FR-02.2 — xterm.js renders with full ANSI colour and escape sequence support.
- FR-02.3 — PTY resizes dynamically when the standalone window resizes (`xterm-addon-fit`).
- FR-02.4 — Copy (Ctrl+Shift+C) and paste (Ctrl+Shift+V / right-click) supported in the console window.
- FR-02.5 — Full keyboard support: Ctrl+C, Ctrl+Z, Tab, arrow keys, function keys.
- FR-02.6 — Auto-reconnect on drop: exponential backoff, max 3 retries, configurable.
- FR-02.7 — Title and connection status indicator: green (connected), yellow (reconnecting), red (disconnected) in the console window header.
- FR-02.8 — Closing the standalone terminal window cleanly closes the backend PTY session and frees resources.
- FR-02.9 — Passwordless window initialization: JWT token is securely passed via routing parameter to authorize backend calls instantly.
- FR-02.10 — Terminal font, font size, and color theme customizable.

---

### FR-03: Multi-Tab Dashboard & Window Sessions

**Priority:** High
**Description:** Multiple simultaneous profile detail views in tabs with multi-window execution.

- FR-03.1 — The main dashboard contains a persistent "Home" anchor tab (profiles, keys, logs, settings) and dynamic tabs for active profiles.
- FR-03.2 — Opening a saved profile spawns a dedicated Profile Details tab showing active host connection state.
- FR-03.3 — Dashboard tabs are cleanly organized and can be switched dynamically.
- FR-03.4 — Supports spawning multiple concurrent connection windows (Terminal consoles and SFTP explorers) per active profile tab.
- FR-03.5 — Active tabs keep their SSH session pools alive in the Express backend in the background.

---

### FR-04: SFTP File Manager

**Priority:** High
**Description:** Dual-pane file manager over SFTP rendered in standalone windows.

- FR-04.1 — SFTP Explorer opens in a standalone window directly from the connected Profile Details tab (no re-authentication — reuses established ssh2 connection).
- FR-04.2 — Left pane: local machine files (Electron fs); Right pane: remote server files.
- FR-04.3 — Navigate by double-clicking folders.
- FR-04.4 — Upload: drag local → remote OR Upload button (native file dialog).
- FR-04.5 — Download: drag remote → local OR Download button (native save dialog).
- FR-04.6 — Rename in-place (F2 or right-click menu).
- FR-04.7 — Delete with confirmation showing item name and size.
- FR-04.8 — Create new folder (Ctrl+Shift+N or right-click).
- FR-04.9 — Show and edit Unix permissions (rwx format) for remote files.
- FR-04.10 — Per-transfer progress delivered via SSE (`EventSource`): filename, bytes transferred, total size, % complete, speed, elapsed time — no polling.
- FR-04.11 — Multiple simultaneous transfers in a queue; each transfer has its own SSE stream keyed by `transferId`.
- FR-04.12 — Transfer history: completed, active, and failed.
- FR-04.13 — Failed transfers: one-click retry with error reason shown.
- FR-04.14 — Toggle hidden files (dotfiles).
- FR-04.15 — Breadcrumb path bar in both panes with click-to-navigate.
- FR-04.16 — Cancel an in-progress transfer; cancellation closes the SSE stream and stops the underlying SFTP operation.

---

### FR-05: SSH Key Management

**Priority:** High
**Description:** Generate, import, store, and assign SSH keys.

- FR-05.1 — Generate RSA (2048 / 4096-bit) and ED25519 keypairs
- FR-05.2 — Import PEM format private keys via file picker
- FR-05.3 — Import OpenSSH format private keys
- FR-05.4 — Import PuTTY PPK keys — auto-converted to OpenSSH
- FR-05.5 — All private keys AES-256-GCM encrypted in SQLite — never plaintext
- FR-05.6 — Optional passphrase protection per stored key
- FR-05.7 — SHA-256 fingerprint and key type displayed per key
- FR-05.8 — Copy public key to clipboard with one click
- FR-05.9 — Export public key to file via native save dialog
- FR-05.10 — Assign stored keys to profiles via the profile form
- FR-05.11 — Delete key with confirmation (warns if key is in use by a profile)
- FR-05.12 — Name and optional description per key

---

### FR-06: Port Forwarding (Tunnels)

**Priority:** High
**Description:** SSH port forwarding tunnels per session managed inline.

- FR-06.1 — Local forwarding: `localhost:localPort → remoteHost:remotePort` via SSH server
- FR-06.2 — Remote forwarding: `remoteHost:remotePort → localhost:localPort`
- FR-06.3 — Dynamic forwarding SOCKS5 proxy (underlying service).
- FR-06.4 — Active tunnels and tunnel addition forms are displayed inline inside the Profile Details tab of connected sessions, serving as a centralized Port Forwarding panel.
- FR-06.5 — Start/stop individual tunnels directly from the card without interrupting existing terminal or SFTP windows.
- FR-06.6 — Port conflict detection: warn before binding a port already in use.

---

### FR-07: Application Lock

**Priority:** Medium
**Description:** Master password lock screen to protect stored credentials.

- FR-07.1 — First-run setup wizard: set master password (or skip to run unlocked)
- FR-07.2 — If lock enabled: lock screen shown on app open before any data is visible
- FR-07.3 — Master password hashed with bcrypt; hash stored in AppConfig table
- FR-07.4 — PBKDF2 derives a 256-bit AES key from master password at unlock — held in memory only, never written to disk
- FR-07.5 — Auto-lock after configurable idle timeout (default 15 minutes)
- FR-07.6 — Lost master password = all encrypted data permanently unrecoverable — shown prominently in UI

---

### FR-08: Audit Logs

**Priority:** Medium
**Description:** Record all connection and transfer events.

- FR-08.1 — Log: SSH connect (profile, host, timestamp, success/fail, error message)
- FR-08.2 — Log: SSH disconnect (duration, reason: user action / timeout / error)
- FR-08.3 — Log: SFTP upload (filename, size, remote path, timestamp, success/fail)
- FR-08.4 — Log: SFTP download (filename, size, local path, timestamp)
- FR-08.5 — Paginated log table with search and date range filter
- FR-08.6 — Export logs as CSV via native save dialog
- FR-08.7 — Auto-purge logs older than N days (configurable, default 90)

---

## 7. Non-Functional Requirements

### NFR-01: Performance

| Metric | Target |
|--------|--------|
| App cold start (Electron window open) | < 4 seconds |
| Vite renderer ready after window opens | < 1 second |
| SSH terminal input-to-display latency | < 50ms |
| Profile list load (100 profiles) | < 200ms |
| SFTP directory listing (1000 files) | < 2 seconds |
| Maximum concurrent SSH sessions | 20 without memory issues |
| SQLite query time (all typical queries) | < 50ms |

### NFR-02: Security

- All passwords, passphrases, private keys AES-256-GCM encrypted before DB write
- AES key derived at runtime from master password via PBKDF2 — never persisted
- Private key material never sent across IPC bridge to renderer
- Express bound to `127.0.0.1` only — never `0.0.0.0`
- JWT expires after 8 hours, re-issued on unlock
- All API inputs validated with zod before reaching controllers
- SFTP file paths sanitized server-side — no `..` traversal

### NFR-03: Reliability

- SSH session errors are isolated per tab — one failure does not affect others
- Auto-reconnect: exponential backoff (1s → 2s → 4s), max 3 retries
- Electron main auto-restarts Express if it crashes
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
- All services independently unit-testable with Jest

---

## 8. Database Schema (SQLite + Prisma)

### 8.0 SQLite Setup

| Item | Detail |
|------|--------|
| DB file | `app.getPath('userData')/sshclient.db` |
| Set by | Electron main — `process.env.DATABASE_URL = file:{path}` |
| Journal mode | WAL (enabled on init) |
| Migrations | `prisma migrate deploy` runs automatically every startup |
| Backup | User copies the `.db` file — it is self-contained |

---

### 8.1 Prisma Schema (`backend/src/prisma/schema.prisma`)

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "windows", "darwin", "darwin-arm64", "linux-x64"]
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// ─── Profile ──────────────────────────────────────────────────────────────

model Profile {
  id                String    @id @default(cuid())
  name              String
  host              String
  port              Int       @default(22)
  username          String
  authMethod        String                   // "password" | "key" | "key+passphrase"
  encryptedPassword String?                  // AES-256-GCM encrypted — null if key auth
  sshKeyId          String?
  group             String?
  terminalTheme     String    @default("dark")
  fontSize          Int       @default(14)
  autoReconnect     Boolean   @default(true)
  lastConnectedAt   DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  sshKey    SSHKey?   @relation(fields: [sshKeyId], references: [id], onDelete: SetNull)
  tunnels   Tunnel[]
  auditLogs AuditLog[]
}

// ─── Tunnel ───────────────────────────────────────────────────────────────

model Tunnel {
  id         String  @id @default(cuid())
  profileId  String
  type       String                          // "local" | "remote" | "dynamic"
  localPort  Int
  remoteHost String?                         // null for dynamic SOCKS5
  remotePort Int?                            // null for dynamic SOCKS5
  autoStart  Boolean @default(false)
  label      String?

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
}

// ─── SSHKey ───────────────────────────────────────────────────────────────

model SSHKey {
  id                  String   @id @default(cuid())
  name                String
  description         String?
  keyType             String                  // "rsa" | "ed25519"
  encryptedPrivateKey String                  // AES-256-GCM encrypted blob
  publicKey           String                  // Stored plaintext — public key is not secret
  fingerprint         String                  // SHA-256 fingerprint display string
  hasPassphrase       Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  profiles Profile[]
}

// ─── AuditLog ─────────────────────────────────────────────────────────────

model AuditLog {
  id            String   @id @default(cuid())
  type          String                        // "connection" | "sftp_upload" | "sftp_download" | "key_used"
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

// ─── AppConfig (single row, id always "singleton") ────────────────────────

model AppConfig {
  id                  String   @id @default("singleton")
  lockEnabled         Boolean  @default(false)
  masterPasswordHash  String?                  // bcrypt hash — null if lock disabled
  encryptionKeySalt   String                   // PBKDF2 salt (hex) — generated on first run
  autoLockMinutes     Int      @default(15)
  logRetentionDays    Int      @default(90)
  theme               String   @default("dark") // "dark" | "light" | "system"
  defaultFont         String   @default("JetBrains Mono")
  defaultFontSize     Int      @default(14)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

---

### 8.2 DB Initialization

```typescript
// backend/src/config/db.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

export const prisma = new PrismaClient();

export async function initDatabase(): Promise<void> {
  execSync('npx prisma migrate deploy', { env: process.env });
  await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;');
  await prisma.$connect();
  console.log('DB ready:', process.env.DATABASE_URL);
}
```

```typescript
// src/main/index.ts — set DB path BEFORE spawning backend
import { app } from 'electron';
import path from 'path';

const dbPath = path.join(app.getPath('userData'), 'sshclient.db');
process.env.DATABASE_URL = `file:${dbPath}`;
```

---

## 9. API Design

### 9.1 Base URL Construction (in renderer)

```typescript
// src/renderer/src/lib/api.ts
import axios from 'axios';

const BASE_URL = `http://127.0.0.1:${window.api.backendPort}/api`;

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('jwt');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

### 9.2 Auth API

```
POST  /api/auth/setup     → First run: set master password
POST  /api/auth/unlock    → Verify master password → returns JWT
POST  /api/auth/lock      → Invalidate current session
GET   /api/auth/status    → { locked: boolean }
```

### 9.3 Profiles API

```
GET    /api/profiles                  → List all profiles
POST   /api/profiles                  → Create profile
GET    /api/profiles/:id              → Get single profile
PUT    /api/profiles/:id              → Update profile
DELETE /api/profiles/:id              → Delete profile
POST   /api/profiles/:id/connect      → Open SSH connection → { sessionId }
POST   /api/profiles/:id/duplicate    → Duplicate profile
```

### 9.4 Sessions API

```
GET    /api/sessions                        → List active sessions
DELETE /api/sessions/:sessionId             → Disconnect session
POST   /api/sessions/:sessionId/reconnect   → Reconnect dropped session
```

### 9.5 WebSocket — Terminal

```
WS  ws://127.0.0.1:{port}/ws/terminal/:sessionId

Client → Server:
  { type: "input",  data: "ls -la\r" }
  { type: "resize", cols: 220, rows: 50 }
  { type: "ping" }

Server → Client:
  { type: "output", data: "..." }
  { type: "status", state: "connected" | "reconnecting" | "disconnected" }
  { type: "error",  message: "Connection refused" }
  { type: "pong" }
```

### 9.6 SFTP API

```
GET    /api/sftp/:sessionId/list         ?path=/home/user   → Directory listing
POST   /api/sftp/:sessionId/upload                          → Upload (multipart/form-data) → { transferId }
GET    /api/sftp/:sessionId/download     ?path=/file        → Download (binary stream) → { transferId } header
DELETE /api/sftp/:sessionId/transfer/:transferId            → Cancel in-progress transfer
POST   /api/sftp/:sessionId/mkdir                           → Create directory
DELETE /api/sftp/:sessionId/delete                          → Delete file or directory
PUT    /api/sftp/:sessionId/rename                          → Rename or move
PUT    /api/sftp/:sessionId/chmod                           → Change permissions
```

### 9.6a SFTP Progress — SSE

All transfer progress is delivered via **Server-Sent Events** (`text/event-stream`). The renderer opens an `EventSource` immediately after receiving the `transferId` from the upload/download response.

```
GET  /api/sftp/:sessionId/progress/:transferId
     Content-Type: text/event-stream
     Cache-Control: no-cache
     Connection: keep-alive

Event stream format (one JSON payload per event):

  data: { "transferId": "t_abc123", "status": "progress",
          "bytesTransferred": 524288, "totalBytes": 2097152,
          "percent": 25, "speedBytesPerSec": 1048576,
          "elapsedMs": 500 }

  data: { "transferId": "t_abc123", "status": "progress",
          "bytesTransferred": 1048576, "totalBytes": 2097152,
          "percent": 50, "speedBytesPerSec": 1100000,
          "elapsedMs": 950 }

  data: { "transferId": "t_abc123", "status": "complete",
          "bytesTransferred": 2097152, "totalBytes": 2097152,
          "percent": 100, "elapsedMs": 1900 }

  [stream closes]

On error:
  data: { "transferId": "t_abc123", "status": "error",
          "message": "SFTP write failed: Permission denied",
          "bytesTransferred": 524288 }

  [stream closes]
```

**Backend implementation notes:**
- Express sets headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no` before writing events
- An in-memory `EventEmitter` (keyed by `transferId`) bridges `ssh2-sftp-client`'s chunk callbacks to the SSE response stream
- `req.on('close', ...)` detects client disconnect — cancels the transfer and cleans up the emitter
- SSE connections are bound to `127.0.0.1` (same as the rest of the backend) — no CORS risk

**Renderer implementation notes (`useSFTP.ts`):**
```typescript
const source = new EventSource(
  `http://127.0.0.1:${backendPort}/api/sftp/${sessionId}/progress/${transferId}`
);
source.onmessage = (e) => {
  const event = JSON.parse(e.data);
  transferStore.updateProgress(event);       // Zustand slice update
  if (event.status === 'complete' || event.status === 'error') {
    source.close();
  }
};
```

### 9.7 SSH Keys API

```
GET    /api/keys                   → List keys (no private key material in response)
POST   /api/keys/generate          → Generate RSA or ED25519 keypair
POST   /api/keys/import            → Import PEM / OpenSSH / PPK key
GET    /api/keys/:id/public        → Get public key text
DELETE /api/keys/:id               → Delete key
```

### 9.8 Tunnels API

```
GET    /api/sessions/:sessionId/tunnels        → List active tunnels
POST   /api/sessions/:sessionId/tunnels        → Start a tunnel
DELETE /api/sessions/:sessionId/tunnels/:id    → Stop a tunnel
```

### 9.9 Logs API

```
GET    /api/logs    ?type=&from=&to=&page=   → Paginated + filtered logs
GET    /api/logs/export                       → CSV download
DELETE /api/logs                              → Clear all logs
```

---

## 10. Security Requirements

### 10.1 Encryption At Rest

| Data | Column | Method |
|------|--------|--------|
| SSH passwords | `Profile.encryptedPassword` | AES-256-GCM |
| SSH private keys | `SSHKey.encryptedPrivateKey` | AES-256-GCM |
| Master password | `AppConfig.masterPasswordHash` | bcrypt cost 12 |
| Public keys | `SSHKey.publicKey` | Plaintext (not secret) |

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

| Endpoint | Limit |
|----------|-------|
| `POST /api/auth/unlock` | 5 attempts/minute → 30s lockout |
| All other API endpoints | 300 req/minute |

### 10.6 Input Validation

- All request bodies validated with `zod` schemas in Express middleware
- SSH hostnames validated against RFC 1123
- Ports validated (1–65535)
- SFTP remote paths sanitized — `..` traversal rejected

---

## 11. UI/UX Requirements

### 11.1 Application Layout

```
┌──────────────────────────────────────────────────────────┐
│  ● ● ●   SSH Client                       [_]  [□]  [X] │  ← Custom Electron TitleBar
├───────────┬──────────────────────────────────────────────┤
│           │  [+] server1 ●  |  server2 ●  |  server3 ●  │  ← Tab Bar
│  Sidebar  ├──────────────────────────────────────────────┤
│           │                                              │
│  🖥 Profiles│          Active Tab Content                │
│  🔑 Keys   │   (Terminal / SFTP / Keys / Logs / Settings)│
│  📋 Logs   │                                              │
│  ⚙ Settings│                                              │
│           │                                              │
├───────────┴──────────────────────────────────────────────┤
│  ● Connected  |  ubuntu@192.168.1.10  |  Session: 00:12  │  ← Status Bar
└──────────────────────────────────────────────────────────┘
```

### 11.2 Colour Themes

- **Dark** (default): `#1a1a1a` bg, `#e5e7eb` text, green terminal cursor
- **Light**: `#ffffff` bg, `#111827` text
- **System**: follows OS preference
- **Terminal schemes** (per-session): Dracula, Nord, Solarized Dark, Monokai, One Dark

### 11.3 Typography

- UI font: system font stack (SF Pro / Segoe UI / Ubuntu)
- Terminal font: JetBrains Mono — bundled as a local font asset, not fetched from CDN
- Terminal font size: 10–24px, configurable

### 11.4 Required UI States

| State | Treatment |
|-------|-----------|
| Loading | Skeleton screen or spinner — never blank white |
| Empty | Illustrated empty state with a clear call-to-action |
| Error | Red toast + inline message + retry button |
| Success | Green toast, auto-dismiss after 3 seconds |

### 11.5 shadcn/ui Components Used

Components copied into `src/renderer/src/components/ui/` via `npx shadcn@latest add`:
`Button`, `Input`, `Textarea`, `Dialog`, `Sheet`, `Tabs`, `Table`, `Badge`, `Tooltip`, `DropdownMenu`, `Select`, `ScrollArea`, `Separator`, `Progress`, `Skeleton`, `Sonner` (toasts)

---

## 12. Development Phases

### Phase 1 — Foundation (Week 1–3)

- Scaffold project with `electron-vite` React + TypeScript template
- Tailwind CSS + shadcn/ui initialized
- Express backend: health check endpoint, portfinder, Prisma + SQLite init
- Electron main spawns backend, passes port to renderer via preload
- App lock: master password setup flow + lock screen UI + JWT auth

**Deliverable:** App launches, lock screen works, renderer talks to backend

---

### Phase 2 — Profiles + SSH Terminal (Week 4–7)

- Profile CRUD: list, create, edit, delete, duplicate (UI + API)
- SSH connection via ssh2 + WebSocket bridge
- xterm.js terminal pane with PTY resize (`xterm-addon-fit`)
- Single tab working — connect, type commands, see output
- Connection status indicator

**Deliverable:** Connect to any SSH server and run interactive commands

---

### Phase 3 — Multi-Tab + SFTP (Week 8–11)

- Tab bar: open, close, reorder (Zustand tabStore + `@hello-pangea/dnd`)
- Tab keyboard shortcuts
- SFTP dual-pane file manager (local + remote panes)
- Upload, download, rename, delete, mkdir, chmod
- Transfer progress tracking and history panel

**Deliverable:** Full multi-session SSH + complete SFTP workflow

---

### Phase 4 — Keys + Port Forwarding (Week 12–15)

- SSH Key Manager: generate RSA/ED25519, import PEM/OpenSSH/PPK
- Assign keys to profiles
- Port forwarding: local, remote, dynamic SOCKS5
- Tunnel panel per session
- Auto-reconnect with exponential backoff

**Deliverable:** Full key management, tunneling, and stable reconnection

---

### Phase 5 — Polish + Packaging (Week 16–18)

- Audit log viewer, filter, CSV export
- Terminal theme selector
- Settings page (theme, font, lock timeout, log retention)
- Auto-updater (`electron-updater`)
- Build pipeline: `.exe` (Windows), `.dmg` (macOS), `.AppImage` (Linux)
- README + basic user docs

**Deliverable:** Shippable v1.0

---

## 13. Dependencies & Libraries

### Renderer — `src/renderer/src/`

```bash
# Routing
react-router-dom              # HashRouter for Electron file:// compat

# Styling & UI
tailwindcss
@tailwindcss/typography
class-variance-authority      # shadcn/ui dep
clsx
tailwind-merge
lucide-react                  # Icons

# shadcn/ui (added via CLI — copy-owned, not a package dep)
# npx shadcn@latest add button dialog input table tabs badge ...

# Terminal
@xterm/xterm
@xterm/addon-fit              # Resize PTY on window resize
@xterm/addon-web-links        # Clickable URLs in terminal
@xterm/addon-search           # Ctrl+F in terminal

# State & Data
zustand
@tanstack/react-query
axios

# Utilities
date-fns
zod
sonner                        # Toast notifications
react-dropzone                # Drag-and-drop file upload (SFTP)
@hello-pangea/dnd             # Tab drag-to-reorder (maintained react-beautiful-dnd fork)
```

### Backend — `backend/`

```bash
express
cors
ws                            # WebSocket server
ssh2                          # SSH client
ssh2-sftp-client              # SFTP operations
@prisma/client                # ORM client
better-sqlite3                # SQLite native driver (used by Prisma)
bcrypt                        # Master password hashing
jsonwebtoken                  # JWT
zod                           # Request body validation
express-rate-limit            # Rate limiting
multer                        # Multipart file upload (SFTP upload endpoint)
node-forge                    # RSA/ED25519 keypair generation
sshpk                         # PPK → OpenSSH key conversion
portfinder                    # Auto-select free localhost port
```

### Electron + Build

```bash
electron                      # v30+
electron-vite                 # Unified build tool
electron-builder              # Cross-platform packaging
electron-updater              # Auto-update
```

### Dev Only

```bash
# Prisma CLI
prisma

# Backend dev runner
ts-node
nodemon

# Type definitions
@types/node @types/react @types/react-dom
@types/express @types/ws @types/bcrypt
@types/ssh2 @types/better-sqlite3
@types/jsonwebtoken @types/multer

# Code quality
eslint prettier

# Testing
jest ts-jest @types/jest
```

---

## 14. Out of Scope (v1)

| Feature | Reason |
|---------|--------|
| Cloud profile sync | Needs backend infrastructure — v2 |
| Team / shared vaults | Requires multi-user auth model |
| SSH agent forwarding | Complex OS keychain integration |
| Mosh protocol | Completely different protocol |
| Serial / Telnet | Out of product vision |
| Built-in remote file editor | Scope creep — download → edit → upload workflow covers it |
| In-app `ssh-copy-id` | Nice to have — v2 |
| Macro / script recording | v2 |
| Terminal session replay | v2 |
| Snap / Flatpak packaging | AppImage covers Linux for v1 |

---

## 15. Known Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `ssh2` failures on unusual SSH server configs | Medium | Use latest stable version; wrap all connections in try/catch; expose raw error in UI |
| xterm.js perf with very high output (log tail) | Medium | Enable WebGL renderer addon; implement output throttling/buffering |
| PPK import accuracy across PPK format versions | Low–Medium | Test with real PuTTY PPK v2/v3 files; sshpk handles both |
| `better-sqlite3` native binary bundling in Electron | Medium | Run `electron-rebuild` post-install; add Prisma engines to `electron-builder` `extraResources` |
| SQLite corruption on OS force-kill | Low | WAL mode enabled on DB init — implemented in `initDatabase()` |
| Prisma engine binary missing in packaged app | Medium | Set all `binaryTargets` in schema.prisma for win/mac/linux; test packaged builds early |
| Electron bundle > 200MB | Low | Use `externalizeDepsPlugin` in electron-vite, tree-shake renderer |
| Windows SFTP path separator issues | Medium | Always use `path.posix` for remote paths; `path` (native) for local paths |
| Port collision on backend auto-assign | Low | `portfinder` scans from 4000 upward — returns first free port |

---

## Appendix A: First Day Setup

```bash
# 1. Scaffold with electron-vite React + TypeScript template
npm create @quick-start/electron@latest ssh-desktop-client -- --template react-ts
cd ssh-desktop-client

# 2. Install and configure Tailwind CSS
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
# Add Tailwind directives to src/renderer/src/assets/main.css

# 3. Install shadcn/ui
npx shadcn@latest init
# Respond to prompts:
#   TypeScript: yes
#   Style: Default
#   Base color: Slate
#   CSS variables: yes
#   Components path: src/renderer/src/components/ui

# Add base components
npx shadcn@latest add button input dialog sheet tabs table badge tooltip \
  dropdown-menu select scroll-area separator progress skeleton sonner

# 4. Install renderer dependencies
npm install react-router-dom zustand @tanstack/react-query axios
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links @xterm/addon-search
npm install date-fns zod sonner react-dropzone @hello-pangea/dnd lucide-react
npm install class-variance-authority clsx tailwind-merge

# 5. Create and setup backend
mkdir backend && cd backend
npm init -y
npm install express cors ws ssh2 ssh2-sftp-client
npm install @prisma/client better-sqlite3 bcrypt jsonwebtoken
npm install zod express-rate-limit multer node-forge sshpk portfinder
npm install -D typescript ts-node nodemon prisma
npm install -D @types/node @types/express @types/ws @types/bcrypt \
  @types/ssh2 @types/better-sqlite3 @types/jsonwebtoken @types/multer

# Init Prisma
npx prisma init --datasource-provider sqlite
# Paste the schema from section 8.1 into backend/prisma/schema.prisma
npx prisma migrate dev --name init

# 6. Back to root — install Electron build tools
cd ..
npm install -D electron-builder electron-updater
```

---

## Appendix B: electron-vite Config

```typescript
// electron.vite.config.ts
import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],     // Keep Node deps external in main process
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),    // @/components, @/hooks, @/store, etc.
      },
    },
    plugins: [react()],
  },
});
```

---

## Appendix C: React Router Route Map

```typescript
// src/renderer/src/App.tsx
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';

// Standalone Connection Window Spawning Routes (Loaded inside popups)
<Route path="/connection/terminal/:sessionId" element={<StandaloneTerminal />} />
<Route path="/connection/sftp/:sessionId" element={<StandaloneSftp />} />

// Main App Dashboard Views (rendered when activeTabId === 'home')
<Route path="/" element={<Home />} />
<Route path="/keys" element={<Keys />} />
<Route path="/logs" element={<Logs />} />
<Route path="/settings" element={<Settings />} />
```

---

## Appendix D: Environment Variables

### Backend `.env` (development only — not committed)

```env
PORT=0                              # portfinder overrides this at runtime
DATABASE_URL=file:./dev.db          # Overridden by Electron main in production
JWT_SECRET=replace-with-256-bit-random-hex
NODE_ENV=development
```

### How Electron injects production values

```typescript
// src/main/index.ts
import { app } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import portfinder from 'portfinder';

async function startBackend() {
  const port = await portfinder.getPortPromise({ port: 4000 });
  const dbPath = path.join(app.getPath('userData'), 'sshclient.db');

  const child = spawn('node', [path.join(__dirname, '../../backend/dist/index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: `file:${dbPath}`,
      NODE_ENV: 'production',
    },
  });

  return port;
}
```

---

*End of SRS Document — v2.0*
