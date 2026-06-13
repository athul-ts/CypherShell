# CypherShell — Spec Index
**SRS Version:** 3.0 | **Last Updated:** 2026-06-01
**Source of Truth:** `SRS_SSH_Desktop_App.md`

> This file is the fast-lookup reference for all requirement IDs. For full text, acceptance criteria, and implementation notes, read the corresponding section in `SRS_SSH_Desktop_App.md`.

---

## How to use this index
- Before implementing anything, find the spec ID here and read its full section in the SRS.
- Every commit must reference at least one ID from this index (e.g. `feat(sftp): implement transfer cancel [BL-01]`).
- When a requirement is completed, update **Status** here AND the corresponding ✅/⚠️/❌ badge in the SRS.

---

## Functional Requirements

### FR-01 — Saved Connection Profiles
**SRS §6.1** | Priority: High | Overall: ✅ Implemented

| ID | Requirement | Status |
|---|---|---|
| FR-01.1 | Profile fields: name, host, port, username, auth method | ✅ |
| FR-01.2 | Home page profile cards with name, host, group, last-connected | ✅ |
| FR-01.3 | "Manage Profile" opens Profile Detail tab | ✅ |
| FR-01.4 | Passwords/passphrases AES-256-GCM encrypted in SQLite | ✅ |
| FR-01.5 | One-click profile duplication | ✅ |
| FR-01.6 | Profile tagging/grouping | ✅ |
| FR-01.7 | Real-time search and filter | ✅ |

---

### FR-02 — SSH Terminal
**SRS §6.2** | Priority: High | Overall: ✅ Implemented

| ID | Requirement | Status |
|---|---|---|
| FR-02.1 | Terminal spawned from Profile Details tab as standalone window | ✅ |
| FR-02.2 | xterm.js full ANSI colour and escape sequence support | ✅ |
| FR-02.3 | PTY resizes dynamically (xterm-addon-fit) | ✅ |
| FR-02.4 | Ctrl+Shift+C copy; right-click paste | ✅ |
| FR-02.5 | Full keyboard support (Ctrl+C, arrows, function keys) | ✅ |
| FR-02.6 | Auto-reconnect with exponential backoff, max 3 retries | ✅ |
| FR-02.7 | Connection status badge | ✅ |
| FR-02.8 | Closing terminal window closes PTY session | ✅ |
| FR-02.9 | JWT passed via route param — no re-auth in popup windows | ✅ |
| FR-02.10 | Font, font size, and color theme customizable | ✅ |
| FR-02.11 | Auto-copy selected text to clipboard on selection | ✅ |

---

### FR-03 — Multi-Tab Dashboard & Window Sessions
**SRS §6.3** | Priority: High | Overall: ✅ Implemented

| ID | Requirement | Status |
|---|---|---|
| FR-03.1 | Persistent Home tab + dynamic Profile Detail tabs | ✅ |
| FR-03.2 | Opening a profile spawns its own Profile Details tab | ✅ |
| FR-03.3 | Tab switching + drag-to-reorder (@hello-pangea/dnd) | ✅ |
| FR-03.4 | Multiple concurrent Terminal and SFTP windows per profile tab | ✅ |
| FR-03.5 | Active tabs keep SSH session pools alive in Express backend | ✅ |

---

### FR-04 — SFTP File Manager
**SRS §6.4** | Priority: High | Overall: ✅ Mostly Implemented

| ID | Requirement | Status |
|---|---|---|
| FR-04.1 | SFTP Explorer opens as standalone window from Profile Details tab | ✅ |
| FR-04.2 | Dual-pane: local left, remote right | ✅ |
| FR-04.3 | Double-click to navigate folders | ✅ |
| FR-04.4 | Upload via button (native file dialog) + drag-and-drop | ✅ |
| FR-04.5 | Download via button (native save dialog) | ✅ |
| FR-04.6 | Rename via right-click; F2 shortcut | ✅ |
| FR-04.7 | Delete with confirmation | ✅ |
| FR-04.8 | New folder via button; Ctrl+Shift+N shortcut | ✅ |
| FR-04.9 | Show and edit Unix permissions (chmod) | ✅ |
| FR-04.10 | Per-transfer SSE progress: filename, bytes, %, speed, elapsed | ✅ |
| FR-04.11 | Multiple simultaneous transfers in queue, each with own SSE stream | ✅ |
| FR-04.12 | Transfer history: completed, active, failed | ✅ |
| FR-04.13 | Failed transfer one-click retry with error reason | ✅ |
| FR-04.14 | Toggle hidden files (dotfiles) | ✅ |
| FR-04.15 | Breadcrumb path bar with click-to-navigate in both panes | ✅ |
| FR-04.16 | Cancel an in-progress transfer | ✅ |

---

### FR-05 — SSH Key Management
**SRS §6.5** | Priority: High | Overall: ✅ Mostly Implemented

| ID | Requirement | Status |
|---|---|---|
| FR-05.1 | Generate RSA (2048/4096-bit) and ED25519 keypairs | ✅ |
| FR-05.2 | Import PEM private keys via file picker | ✅ |
| FR-05.3 | Import OpenSSH private keys | ✅ |
| FR-05.4 | Import PuTTY PPK keys (auto-convert via sshpk) | ✅ |
| FR-05.5 | All private keys AES-256-GCM encrypted in SQLite | ✅ |
| FR-05.6 | Optional passphrase protection per stored key | ✅ |
| FR-05.7 | SHA-256 fingerprint and key type displayed | ✅ |
| FR-05.8 | Copy public key to clipboard | ✅ |
| FR-05.9 | Export public key to file via native save dialog | ✅ |
| FR-05.10 | Assign stored keys to profiles via profile form | ✅ |
| FR-05.11 | Delete with confirmation; warn if key in use by profiles | ✅ |
| FR-05.12 | Name and optional description per key | ✅ |

---

### FR-06 — Port Forwarding (Tunnels)
**SRS §6.6** | Priority: High | Overall: ✅ Mostly Implemented

| ID | Requirement | Status |
|---|---|---|
| FR-06.1 | Local forwarding: localhost:localPort → remoteHost:remotePort | ✅ |
| FR-06.2 | Remote forwarding: remoteHost:remotePort → localhost:localPort | ✅ |
| FR-06.3 | Dynamic SOCKS5 proxy | ✅ |
| FR-06.4 | Tunnel panel in Profile Details tab | ✅ |
| FR-06.5 | Start/stop tunnels independently of terminal/SFTP sessions | ✅ |
| FR-06.6 | Port conflict detection before binding | ✅ |

---

### FR-07 — Application Lock
**SRS §6.7** | Priority: Medium | Overall: ✅ Fully Implemented

| ID | Requirement | Status |
|---|---|---|
| FR-07.1 | First-run setup wizard with master password or skip | ✅ |
| FR-07.2 | Lock screen on app open if lock enabled | ✅ |
| FR-07.3 | Master password hashed with bcrypt (cost 12) | ✅ |
| FR-07.4 | PBKDF2-SHA512 derives AES key at unlock — memory only, never persisted | ✅ |
| FR-07.5 | Auto-lock after configurable idle timeout (default 15 min) | ✅ |
| FR-07.6 | Lost master password = all encrypted data unrecoverable — shown prominently | ✅ |

---

### FR-08 — Audit Logs
**SRS §6.8** | Priority: Medium | Overall: ✅ Mostly Implemented

| ID | Requirement | Status |
|---|---|---|
| FR-08.1 | Log SSH connect (profile, host, timestamp, success/fail) | ✅ |
| FR-08.2 | Log SSH disconnect with duration and reason | ✅ |
| FR-08.3 | Log SFTP upload (filename, size, remote path, timestamp) | ✅ |
| FR-08.4 | Log SFTP download (filename, size, local path, timestamp) | ✅ |
| FR-08.5 | Paginated log table with search and date range filter | ✅ |
| FR-08.6 | Export logs as CSV via native save dialog | ✅ |
| FR-08.7 | Auto-purge logs older than N days | ✅ |
| FR-08.8 | Clear all logs via UI | ✅ |

---

## Non-Functional Requirements

**SRS §7** | All NFRs verified against current implementation

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | Performance targets (cold start <4s, terminal latency <50ms, etc.) | ✅ |
| NFR-02 | Security — AES-256-GCM, PBKDF2, context isolation, localhost-only | ✅ |
| NFR-03 | Reliability — session isolation, auto-reconnect, WAL mode | ✅ |
| NFR-04 | Usability — destructive confirms, loading states, plain-language errors | ✅ |
| NFR-05 | Cross-platform — Windows, macOS, Linux | ✅ |
| NFR-06 | Maintainability — 100% TypeScript, ESLint, thin controllers, Prisma schema = source of truth | ✅ |

---

## v1.1 Backlog

**SRS §17** | All unimplemented requirements from v1.0

| ID | Feature | Priority | Linked FR | Est. Complexity |
|---|---|---|---|---|
| ~~BL-01~~ | ~~Cancel in-progress SFTP transfer~~ | ~~High~~ | FR-04.16 | ✅ Done |
| ~~BL-02~~ | ~~Port conflict detection before tunnel bind~~ | ~~Medium~~ | FR-06.6 | ✅ Done |
| ~~BL-03~~ | ~~Warn when deleting SSH key in use by profiles~~ | ~~Medium~~ | FR-05.11 | ✅ Done |
| ~~BL-04~~ | ~~Audit log auto-purge scheduler~~ | ~~Medium~~ | FR-08.7 | ✅ Done |
| ~~BL-05~~ | ~~SSH disconnect reason logging~~ | ~~Low~~ | FR-08.2 | ✅ Done |
| ~~BL-06~~ | ~~DELETE /api/logs clear-all endpoint + UI button~~ | ~~Low~~ | FR-08.8 | ✅ Done |
| ~~BL-07~~ | ~~SFTP keyboard shortcuts (F2 rename, Ctrl+Shift+N folder)~~ | ~~Low~~ | FR-04.6, FR-04.8 | ✅ Done |
| ~~BL-08~~ | ~~Terminal right-click paste~~ | ~~Low~~ | FR-02.4 | ✅ Done |
| ~~BL-09~~ | ~~Terminal auto-copy on text selection~~ | ~~Medium~~ | FR-02.11 | ✅ Done |

---

## Architecture Decisions

| ID | Decision | Record |
|---|---|---|
| ADR-001 | Use electron-vite over Next.js/CRA | [specs/decisions/ADR-001-electron-vite.md](decisions/ADR-001-electron-vite.md) |
| ADR-002 | Spawn Express as child process over direct Electron IPC | [specs/decisions/ADR-002-express-backend.md](decisions/ADR-002-express-backend.md) |
| ADR-003 | SQLite + Prisma over cloud/external database | [specs/decisions/ADR-003-sqlite-prisma.md](decisions/ADR-003-sqlite-prisma.md) |

---

## Status Legend

| Symbol | Meaning |
|---|---|
| ✅ | Fully implemented and verified |
| ⚠️ | Partially implemented — see linked BL item for what is missing |
| ❌ | Not implemented — backlog item exists |
