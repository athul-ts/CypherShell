# CypherShell — Spec Index

**SRS Version:** 3.6 | **Last Updated:** 2026-11-20
**Source of Truth:** `SRS_SSH_Desktop_App.md`

> This file is the fast-lookup reference for all requirement IDs. For full text, acceptance criteria, and implementation notes, read the corresponding section in `SRS_SSH_Desktop_App.md`.

---

## How to use this index

- Before implementing anything, find the spec ID here and read its full section in the SRS.
- Every commit must reference at least one ID from this index (e.g. `feat(sftp): implement transfer cancel [BL-01]`).
- When a requirement is completed, update **Status** here AND the corresponding ✅/⚠️/❌ badge in the SRS.
- A ✅ means the behaviour was verified, not just that code exists. The 2026-11-10 audit downgraded requirements whose implementation did not work; each ⚠️ names its backlog item or is marked "tracked" in the SRS.

---

## Functional Requirements

### FR-01 — Saved Connection Profiles

**SRS §6.1** | Priority: High | Overall: ✅ Implemented

| ID      | Requirement                                                                  | Status |
| ------- | ---------------------------------------------------------------------------- | ------ |
| FR-01.1 | Profile fields: name, host, port, username, auth method                      | ✅     |
| FR-01.2 | Home page profile cards with name, host, group, last-connected               | ✅     |
| FR-01.3 | "Manage Profile" opens Profile Detail tab                                    | ✅     |
| FR-01.4 | Passwords/passphrases AES-256-GCM encrypted in SQLite                        | ✅     |
| FR-01.5 | One-click profile duplication                                                | ✅     |
| FR-01.6 | Profile tagging/grouping                                                     | ✅     |
| FR-01.7 | Real-time search and filter                                                  | ✅     |
| FR-01.8 | Edit existing profile fields from Profile Detail tab and Home page card menu | ✅     |
| FR-01.9 | Keyboard-interactive login for password profiles                             | ✅     |

---

### FR-02 — SSH Terminal

**SRS §6.2** | Priority: High | Overall: ✅ Implemented

| ID       | Requirement                                                    | Status |
| -------- | -------------------------------------------------------------- | ------ |
| FR-02.1  | Terminal spawned from Profile Details tab as standalone window | ✅     |
| FR-02.2  | xterm.js full ANSI colour and escape sequence support          | ✅     |
| FR-02.3  | PTY resizes dynamically (xterm-addon-fit)                      | ✅     |
| FR-02.4  | Ctrl+Shift+C copy; right-click paste                           | ✅     |
| FR-02.5  | Full keyboard support (Ctrl+C, arrows, function keys)          | ✅     |
| FR-02.6  | Auto-reconnect with exponential backoff, max 3 retries         | ✅     |
| FR-02.7  | Connection status badge                                        | ✅     |
| FR-02.8  | Closing terminal window closes PTY session                     | ✅     |
| FR-02.9  | JWT passed via route param — no re-auth in popup windows       | ✅     |
| FR-02.10 | Font, font size, and color theme customizable                  | ✅     |
| FR-02.11 | Auto-copy selected text to clipboard on selection              | ✅     |

---

### FR-03 — Multi-Tab Dashboard & Window Sessions

**SRS §6.3** | Priority: High | Overall: ✅ Implemented

| ID      | Requirement                                                   | Status |
| ------- | ------------------------------------------------------------- | ------ |
| FR-03.1 | Persistent Home tab + dynamic Profile Detail tabs             | ✅     |
| FR-03.2 | Opening a profile spawns its own Profile Details tab          | ✅     |
| FR-03.3 | Tab switching + drag-to-reorder (@hello-pangea/dnd)           | ✅     |
| FR-03.4 | Multiple concurrent Terminal and SFTP windows per profile tab | ✅     |
| FR-03.5 | Active tabs keep SSH session pools alive in Express backend   | ✅     |

---

### FR-04 — SFTP File Manager

**SRS §6.4** | Priority: High | Overall: ⚠️ Partially Implemented (FR-04.15 local pane tracked)

| ID       | Requirement                                                        | Status |
| -------- | ------------------------------------------------------------------ | ------ |
| FR-04.1  | SFTP Explorer opens as standalone window from Profile Details tab  | ✅     |
| FR-04.2  | Dual-pane: local left, remote right                                | ✅     |
| FR-04.3  | Double-click to navigate folders                                   | ✅     |
| FR-04.4  | Upload via button (native file dialog) + drag-and-drop             | ✅     |
| FR-04.5  | Download via button (native save dialog)                           | ✅     |
| FR-04.6  | Rename via right-click; F2 shortcut                                | ✅     |
| FR-04.7  | Delete with confirmation                                           | ✅     |
| FR-04.8  | New folder via button; Ctrl+Shift+N shortcut                       | ✅     |
| FR-04.9  | Show and edit Unix permissions (chmod)                             | ✅     |
| FR-04.10 | Per-transfer SSE progress: filename, bytes, %, speed, elapsed      | ✅     |
| FR-04.11 | Multiple simultaneous transfers in queue, each with own SSE stream | ✅     |
| FR-04.12 | Transfer history: completed, active, failed                        | ✅     |
| FR-04.13 | Failed transfer one-click retry with error reason                  | ✅     |
| FR-04.14 | Toggle hidden files (dotfiles)                                     | ✅     |
| FR-04.15 | Breadcrumb path bar with click-to-navigate in both panes           | ⚠️     |
| FR-04.16 | Cancel an in-progress transfer                                     | ✅     |

---

### FR-05 — SSH Key Management

**SRS §6.5** | Priority: High | Overall: ✅ Implemented

| ID       | Requirement                                              | Status |
| -------- | -------------------------------------------------------- | ------ |
| FR-05.1  | Generate RSA (2048/4096-bit) and ED25519 keypairs        | ✅     |
| FR-05.2  | Import PEM private keys via file picker                  | ✅     |
| FR-05.3  | Import OpenSSH private keys                              | ✅     |
| FR-05.4  | Import PuTTY PPK keys (auto-convert via sshpk)           | ✅     |
| FR-05.5  | All private keys AES-256-GCM encrypted in SQLite         | ✅     |
| FR-05.6  | Optional passphrase protection per stored key            | ✅     |
| FR-05.7  | SHA-256 fingerprint and key type displayed               | ✅     |
| FR-05.8  | Copy public key to clipboard                             | ✅     |
| FR-05.9  | Export public key to file via native save dialog         | ✅     |
| FR-05.10 | Assign stored keys to profiles via profile form          | ✅     |
| FR-05.11 | Delete with confirmation; warn if key in use by profiles | ✅     |
| FR-05.12 | Name and optional description per key                    | ✅     |

---

### FR-06 — Port Forwarding (Tunnels)

**SRS §6.6** | Priority: High | Overall: ✅ Implemented

| ID      | Requirement                                                    | Status |
| ------- | -------------------------------------------------------------- | ------ |
| FR-06.1 | Local forwarding: localhost:localPort → remoteHost:remotePort  | ✅     |
| FR-06.2 | Remote forwarding: remoteHost:remotePort → localhost:localPort | ✅     |
| FR-06.3 | Dynamic SOCKS5 proxy                                           | ✅     |
| FR-06.4 | Tunnel panel in Profile Details tab                            | ✅     |
| FR-06.5 | Start/stop tunnels independently of terminal/SFTP sessions     | ✅     |
| FR-06.6 | Port conflict detection before binding                         | ✅     |

---

### FR-07 — Application Lock

**SRS §6.7** | Priority: Medium | Overall: ✅ Implemented

| ID      | Requirement                                                                 | Status |
| ------- | --------------------------------------------------------------------------- | ------ |
| FR-07.1 | First-run setup wizard with master password or skip                         | ✅     |
| FR-07.2 | Lock screen on app open if lock enabled                                     | ✅     |
| FR-07.3 | Master password hashed with bcrypt (cost 12)                                | ✅     |
| FR-07.4 | PBKDF2-SHA512 derives AES key at unlock — memory only, never persisted      | ✅     |
| FR-07.5 | Auto-lock after configurable idle timeout (default 15 min)                  | ✅     |
| FR-07.6 | Lost master password = all encrypted data unrecoverable — shown prominently | ✅     |
| FR-07.7 | Lock-mode changes re-encrypt all secrets; disabling needs the password      | ✅     |
| FR-07.8 | Change master password                                                      | ✅     |

---

### FR-08 — Audit Logs

**SRS §6.8** | Priority: Medium | Overall: ✅ Implemented

| ID      | Requirement                                               | Status |
| ------- | --------------------------------------------------------- | ------ |
| FR-08.1 | Log SSH connect (profile, host, timestamp, success/fail)  | ✅     |
| FR-08.2 | Log SSH disconnect with duration and reason               | ✅     |
| FR-08.3 | Log SFTP upload (filename, size, remote path, timestamp)  | ✅     |
| FR-08.4 | Log SFTP download (filename, size, local path, timestamp) | ✅     |
| FR-08.5 | Paginated log table with search and date range filter     | ✅     |
| FR-08.6 | Export logs as CSV via native save dialog                 | ✅     |
| FR-08.7 | Auto-purge logs older than N days                         | ✅     |
| FR-08.8 | Clear all logs via UI                                     | ✅     |

---

### FR-09 — Profile Export/Import

**SRS §6.9** | Priority: Medium | Overall: ✅ Implemented

| ID      | Requirement                                                                                              | Status |
| ------- | -------------------------------------------------------------------------------------------------------- | ------ |
| FR-09.1 | Export selected/all profiles as `.json` via native save dialog                                           | ✅     |
| FR-09.2 | Export includes metadata: name, host, port, username, authMethod, group, terminal settings, tunnel rules | ✅     |
| FR-09.3 | Export explicitly excludes all SSH key material; `linkedKeyName` included as hint only                   | ✅     |
| FR-09.4 | Import profiles from a CypherShell profile export `.json` file                                           | ✅     |
| FR-09.5 | On import, profiles with `linkedKeyName` resolve to existing SSH key by name and link automatically      | ✅     |
| FR-09.6 | Single export file may contain multiple profiles; all imported in one operation                          | ✅     |
| FR-09.7 | Import conflict (name exists): user chooses Skip / Rename / Overwrite per profile                        | ✅     |
| FR-09.8 | Export action in Profiles list page (global "Export All" + per-profile context menu)                     | ✅     |
| FR-09.9 | Import action in Profiles list page                                                                      | ✅     |

---

### FR-10 — SSH Key Export/Import

**SRS §6.10** | Priority: Medium | Overall: ✅ Implemented

| ID      | Requirement                                                                                                                                                         | Status |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| FR-10.1 | Export key as encrypted `.cskb` file via native save dialog (one key per file)                                                                                      | ✅     |
| FR-10.2 | `.cskb` bundle: JSON envelope with publicKey (plaintext) + AES-256-GCM encrypted private key, IV, salt, authTag; key derived from user passphrase via PBKDF2-SHA512 | ✅     |
| FR-10.3 | Export passphrase required and confirmed before file is written                                                                                                     | ✅     |
| FR-10.4 | Import `.cskb` file via native file picker                                                                                                                          | ✅     |
| FR-10.5 | On import: unwrap with export passphrase, re-encrypt under app master key — passphrase not retained                                                                 | ✅     |
| FR-10.6 | Import conflict (key name exists): Skip / Rename / Overwrite                                                                                                        | ✅     |
| FR-10.7 | Export and Import accessible from SSH Keys page per-key action menu                                                                                                 | ✅     |
| FR-10.8 | `.cskb` format distinct from FR-05.9 public-key export (`.cskb` = full encrypted key backup)                                                                        | ✅     |

---

### FR-11 — SSH Host-Key Verification

**SRS §6.11** | Priority: High | Overall: ❌ Not Implemented (BL-38)

| ID      | Requirement                                                          | Status |
| ------- | -------------------------------------------------------------------- | ------ |
| FR-11.1 | First connect shows key type + SHA-256 fingerprint; user must accept | ✅     |
| FR-11.2 | Accepted host keys stored per host:port in a `KnownHost` table       | ✅     |
| FR-11.3 | Changed host key aborts before credentials are sent, with a warning  | ✅     |
| FR-11.4 | Known hosts can be listed and removed in Settings                    | ✅     |
| FR-11.5 | Host-key decisions the backend observes written to the audit log     | ✅     |

---

## Non-Functional Requirements

**SRS §7** | Re-verified against the implementation in the 2026-11-10 audit

| ID     | Requirement                                                                                  | Status |
| ------ | -------------------------------------------------------------------------------------------- | ------ |
| NFR-01 | Performance targets (cold start <4s, terminal latency <50ms, etc.) — not yet measured        | ⚠️     |
| NFR-02 | Security — AES-256-GCM, PBKDF2, context isolation, localhost-only                            | ⚠️     |
| NFR-03 | Reliability — session isolation, auto-reconnect, WAL mode                                    | ✅     |
| NFR-04 | Usability — destructive confirms, loading states, plain-language errors                      | ✅     |
| NFR-05 | Cross-platform — Windows, macOS, Linux                                                       | ⚠️     |
| NFR-06 | Maintainability — 100% TypeScript, ESLint, thin controllers, Prisma schema = source of truth | ⚠️     |
| NFR-07 | Release & distribution — Win/Linux/macOS installers, CI matrix, auto-update metadata         | ✅     |

---

## v1.1 Backlog

**SRS §17** | BL-01 … BL-09: v1.0 gaps. BL-10 … BL-16: defects found by the 2026-11-10 audit in requirements that were marked ✅ — all implemented the same day. BL-17 … BL-26: the audit's Phase 2, security hardening (NFR-02 additions) — all implemented 2026-11-11. BL-27: e2e tests on a throwaway profile (test-only). BL-28: audit-log CSV export (FR-08.6). BL-29 … BL-35: Phase 3, remaining functional gaps (specified 2026-11-18)

| ID        | Feature                                                             | Priority     | Linked FR                            | Est. Complexity |
| --------- | ------------------------------------------------------------------- | ------------ | ------------------------------------ | --------------- |
| ~~BL-01~~ | ~~Cancel in-progress SFTP transfer~~                                | ~~High~~     | FR-04.16                             | ✅ Done         |
| ~~BL-02~~ | ~~Port conflict detection before tunnel bind~~                      | ~~Medium~~   | FR-06.6                              | ✅ Done         |
| ~~BL-03~~ | ~~Warn when deleting SSH key in use by profiles~~                   | ~~Medium~~   | FR-05.11                             | ✅ Done         |
| ~~BL-04~~ | ~~Audit log auto-purge scheduler~~                                  | ~~Medium~~   | FR-08.7                              | ✅ Done         |
| ~~BL-05~~ | ~~SSH disconnect reason logging~~                                   | ~~Low~~      | FR-08.2                              | ✅ Done         |
| ~~BL-06~~ | ~~DELETE /api/logs clear-all endpoint + UI button~~                 | ~~Low~~      | FR-08.8                              | ✅ Done         |
| ~~BL-07~~ | ~~SFTP keyboard shortcuts (F2 rename, Ctrl+Shift+N folder)~~        | ~~Low~~      | FR-04.6, FR-04.8                     | ✅ Done         |
| ~~BL-08~~ | ~~Terminal right-click paste~~                                      | ~~Low~~      | FR-02.4                              | ✅ Done         |
| ~~BL-09~~ | ~~Terminal auto-copy on text selection~~                            | ~~Medium~~   | FR-02.11                             | ✅ Done         |
| ~~BL-10~~ | ~~Auth & lock lifecycle (first-run wizard, safe lock switch)~~      | ~~Critical~~ | FR-07.1, FR-07.7, FR-08.7            | ✅ Done         |
| ~~BL-11~~ | ~~SSH session lifecycle (consumer-aware reaper, heartbeat)~~        | ~~Critical~~ | FR-02.8, FR-03.5, FR-06.5            | ✅ Done         |
| ~~BL-12~~ | ~~SSH key formats (OpenSSH generation, import conversion)~~         | ~~Critical~~ | FR-05.1, FR-05.4, FR-05.6            | ✅ Done         |
| ~~BL-13~~ | ~~Profile form edits (keep password, Key + Passphrase option)~~     | ~~Critical~~ | FR-01.1, FR-01.8                     | ✅ Done         |
| ~~BL-14~~ | ~~SFTP reliability (in-app dialogs, per-transfer channels)~~        | ~~Critical~~ | FR-04.6–FR-04.9, FR-04.16            | ✅ Done         |
| ~~BL-15~~ | ~~Terminal text encoding (UTF-8 in and out)~~                       | ~~Critical~~ | FR-02.2                              | ✅ Done         |
| ~~BL-16~~ | ~~Tunnel stability & backend auto-restart~~                         | ~~Critical~~ | FR-06.1, NFR-03                      | ✅ Done         |
| ~~BL-17~~ | ~~Local API caller auth (launch secret, Origin, Host)~~             | ~~Critical~~ | NFR-02                               | ✅ Done         |
| ~~BL-18~~ | ~~Lock enforcement (WebSocket revocation, close windows, idle)~~    | ~~Critical~~ | FR-07.5, NFR-02                      | ✅ Done         |
| ~~BL-19~~ | ~~Token & secret hygiene (in-memory JWT secret, `jti`, 0600)~~      | ~~High~~     | NFR-02                               | ✅ Done         |
| ~~BL-20~~ | ~~Connection window token hand-off only (no token in URL)~~         | ~~High~~     | FR-02.9                              | ✅ Done         |
| ~~BL-21~~ | ~~Electron window hardening (window.open, navigation, IPC sender)~~ | ~~High~~     | NFR-02                               | ✅ Done         |
| ~~BL-22~~ | ~~Dialog-bound file IPC (`saveTextFile` / `openTextFile`)~~         | ~~High~~     | FR-09.1, FR-09.4, FR-10.1            | ✅ Done         |
| ~~BL-23~~ | ~~Request validation for SFTP, tunnel and config APIs~~             | ~~High~~     | NFR-02, FR-04.16, FR-06              | ✅ Done         |
| ~~BL-24~~ | ~~macOS update notice (no unsigned auto-install)~~                  | ~~Medium~~   | NFR-07                               | ✅ Done         |
| ~~BL-25~~ | ~~Single app instance~~                                             | ~~Medium~~   | NFR-03                               | ✅ Done         |
| ~~BL-26~~ | ~~Master password policy (10 characters, strength hint)~~           | ~~Medium~~   | FR-07.1, FR-07.7                     | ✅ Done         |
| ~~BL-27~~ | ~~E2E tests on a throwaway profile (`--user-data-dir`)~~            | ~~Medium~~   | NFR-06                               | ✅ Done         |
| ~~BL-28~~ | ~~Audit log CSV export (API client + `saveTextFile`, quoting)~~     | ~~Medium~~   | FR-08.6                              | ✅ Done         |
| ~~BL-29~~ | ~~Terminal resize and reconnect~~                                   | ~~Medium~~   | FR-02.3, FR-02.6, FR-02.7            | ✅ Done         |
| ~~BL-30~~ | ~~SFTP drag-in, retry, folder delete, paths~~                       | ~~Medium~~   | FR-04.4, FR-04.7, FR-04.13, FR-04.15 | ✅ Done         |
| ~~BL-31~~ | ~~Last connected, form validation, port error~~                     | ~~Medium~~   | FR-01.2, FR-01.8.7, FR-06.6          | ✅ Done         |
| ~~BL-32~~ | ~~Audit reasons, paging, filters, CSV safety~~                      | ~~Medium~~   | FR-08.2, FR-08.5, FR-08.6            | ✅ Done         |
| ~~BL-33~~ | ~~Key bundle overwrite in place~~                                   | ~~Low~~      | FR-10.6                              | ✅ Done         |
| ~~BL-34~~ | ~~Saved tunnel rules~~                                              | ~~Medium~~   | FR-06.4, FR-09.2                     | ✅ Done         |
| ~~BL-35~~ | ~~Light theme and bundled font~~                                    | ~~Low~~      | §11.2, §11.3                         | ✅ Done         |
| ~~BL-36~~ | ~~Dependency security update (Electron 45)~~                        | ~~High~~     | NFR-02, NFR-07                       | ✅ Done         |
| ~~BL-37~~ | ~~CI on every branch~~ | ~~High~~ | NFR-06, NFR-07 | ✅ Done |
| ~~BL-38~~ | ~~SSH host-key verification~~ | ~~High~~ | FR-11.1 … FR-11.5 | ✅ Done |
| ~~BL-39~~ | ~~Change master password~~ | ~~High~~ | FR-07.8 | ✅ Done |
| ~~BL-40~~ | ~~Keyboard-interactive login~~ | ~~Medium~~ | FR-01.9 | ✅ Done |
| ~~BL-41~~ | ~~Automatic SSH reconnect~~ | ~~Medium~~ | FR-02.6, NFR-03 | ✅ Done |
| ~~BL-42~~ | ~~Thin controllers~~ | ~~Medium~~ | NFR-06 | ✅ Done |
| ~~BL-43~~ | ~~Logging~~ | ~~Medium~~ | NFR-06 | ✅ Done |
| ~~BL-44~~ | ~~Cleanup and documentation~~ | ~~Low~~ | NFR-06 | ✅ Done |
| BL-45     | Performance checks                                                  | Medium       | NFR-01                               | ❌ Open         |
| BL-46     | Backend in utilityProcess + fuses (needs ADR-005)                   | Medium       | NFR-02                               | ❌ Open         |

---

## Architecture Decisions

| ID      | Decision                                                 | Record                                                                                             |
| ------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ADR-001 | Use electron-vite over Next.js/CRA                       | [specs/decisions/ADR-001-electron-vite.md](decisions/ADR-001-electron-vite.md)                     |
| ADR-002 | Spawn Express as child process over direct Electron IPC  | [specs/decisions/ADR-002-express-backend.md](decisions/ADR-002-express-backend.md)                 |
| ADR-003 | SQLite + Prisma over cloud/external database             | [specs/decisions/ADR-003-sqlite-prisma.md](decisions/ADR-003-sqlite-prisma.md)                     |
| ADR-004 | Reusable matrix release pipeline; unsigned macOS in v1   | [specs/decisions/ADR-004-release-pipeline.md](decisions/ADR-004-release-pipeline.md)               |
| ADR-005 | Backend in a utility process + Electron fuses (proposed) | [specs/decisions/ADR-005-backend-utility-process.md](decisions/ADR-005-backend-utility-process.md) |

---

## Status Legend

| Symbol | Meaning                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------- |
| ✅     | Fully implemented and verified                                                                     |
| ⚠️     | Partially implemented — see the linked BL item, or the SRS note for gaps tracked but not scheduled |
| ❌     | Not implemented — backlog item exists or the SRS marks it "not scheduled"                          |
