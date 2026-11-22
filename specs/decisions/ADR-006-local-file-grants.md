# ADR-006 — Local files by grant from the main process

**Date:** 2026-11-22
**Status:** Proposed
**Deciders:** Athul T S

---

## Context

The SFTP upload and download requests carry a raw local path (`localPath`) from the renderer. The backend checks only its shape (BL-23: absolute, normalized, a regular file or an existing folder) and then passes it to `fs` and to ssh2's `fastPut` / `fastGet`, which open the file themselves.

GitHub CodeQL (js/path-injection, "Uncontrolled data used in path expression") reported five high alerts for this on PR #23: `local-path.service.ts` (the `stat` / `lstat` checks) and `sftp.service.ts` (the `stat` for the audit size). The project rule in `CLAUDE.md` says the same: user-supplied paths must be validated against allowed base directories. BL-23 deliberately had none, because a native dialog may pick any folder.

What the backend trusts today is whatever the page sends. The page is reachable only with the session token and the launch secret, and windows are locked down (BL-17 … BL-22), but a compromised page could:

- read any file the user can read and upload it to a server (SSH keys, the app's own storage key and database);
- write any file the user can write — shell start-up files, autostart folders, or the per-user install folder, whose `resources/backend` lies outside ASAR integrity (ADR-005), which amounts to code execution.

Related defects found while designing this: any `text/plain` drop on the remote pane is used as a local path; a remote file name containing `..\` dropped on the local pane escapes the folder on Windows; the local pane cannot go Up to the home folder.

Constraints:

- The user must still be able to upload any file they pick in a native dialog or drop from the OS, and save a download anywhere they choose.
- The local pane is navigated by the page itself, so whatever it can reach, a compromised page can reach.
- The backend is an Electron utility process (ADR-005); the only channel to main is `process.parentPort`.

---

## Decision

The main process is the only authority for local files. It issues an opaque grant (128-bit random id) for each file or folder the user chooses, and the backend resolves the grant with main for every transfer. The backend accepts no local path from the renderer.

- **Where grants come from:** the native Open dialog (`read`), the native Save dialog (`write`), a file dropped from the OS (`read`, path taken by the preload from the `File`, never from the page), and each local-pane listing (`dir`, read-only: a file directly inside the folder, by name).
- **Who gets them:** only SFTP connection windows; each grant is bound to the window's SSH session and lives until the window closes or the app locks.
- **How they resolve:** the backend sends `grant-resolve { requestId, sessionId, grant, access, name? }` over the parent port; main checks the session, the access against the kind, and for `dir` grants the name (one segment, Windows-safe) and containment, then answers `grant-resolved { ok, path | code }`. The backend keeps its BL-23 checks on the returned path.
- **Local-pane policy:** under home only; the app's own `userData` and `sessionData` folders are refused, compared as native real paths. Dialog picks and OS drops are never refused by folder — the user chose them outside the page.
- **Downloads into the local pane** go through the native Save dialog, pre-filled with that folder and a cleaned name, so every local write is confirmed by the user.

---

## Reasoning

- The page can no longer name an arbitrary path. Dialog picks and OS drops cannot be forged by page script (the preload derives the path from a real `File`; a script-built `File` has none). Local-pane reads are confined to home minus the app's data, and local writes always pass through a native dialog.
- Pulling the grant at use time (instead of main pushing grants into the backend) avoids the race between the IPC reply to the renderer and the renderer's HTTP request, makes revocation immediate, and keeps all path state and policy in one process.
- Name checks and containment live in main, next to the policy that issued the folder grant, so the backend never builds a local path from request data — the flow CodeQL flags.
- Alerts close without suppressions: request data reaches only `postMessage`, and the path the backend uses comes from a parent-port message, which CodeQL does not treat as a remote source.

---

## Alternatives considered

- **Dismiss the alerts as "won't fix".** No work, but the page keeps full read and write access through the backend.
- **A base-directory allowlist in the backend.** Breaks dialog picks outside the list, and a list under home still includes `~/.ssh`, start-up files and the install folder.
- **Main pushes grants to the backend.** The renderer's HTTP request can arrive before the grant; revocation needs extra messages; grants would be lost on a backend restart.
- **Signed (HMAC) tokens carrying the path.** Stateless, but the path is still read from the request (CodeQL keeps flagging it) and a token cannot be revoked when its window closes.
- **Main streams the file data to the backend over a MessagePort.** Removes local paths from the backend entirely, but replaces ssh2's fast parallel transfers with a custom stream protocol.

---

## Consequences

- **Positive:** the backend can no longer be used to read or write arbitrary local files; the five CodeQL alerts close; the drop and file-name defects are fixed; the local pane reaches the home folder.
- **Positive:** the local-file rules (home, refused folders, name rules) are unit-tested in one pure module.
- **Negative:** dropping a remote file on the local pane opens a Save dialog instead of saving at once (one more click).
- **Negative:** a grant does not survive its window. A Retry after the window was reloaded asks the user to pick the file again.
- **Negative:** each transfer adds one parent-port round trip (milliseconds) before it starts.

**Rules that keep the alerts closed** (also a review checklist):

1. Never build any part of a local path in the backend from request data (such as `local.name`).
2. Never build the resolved result from the request object (`{ ...local, path }` stays tainted).
3. No fallback that accepts `localPath` when main is unavailable.
4. Backend test fakes return constant paths chosen by comparing the grant id; they never compute a path from the request.

**Residual risks (accepted):**

- The file can be swapped between main's check and ssh2 opening it (time-of-check/time-of-use). This needs another process running as the same user, which is outside the threat model.
- `resources/backend` is outside ASAR integrity (ADR-005); this decision removes the backend as a way to write there, but another same-user process still can.
- A compromised page can still read files under home (outside the app's data folders) through the local pane, because the pane is page-driven; it can no longer write anywhere without a native dialog.

---

## Related

- `src/main/localGrants.ts`, `src/main/localFiles.ts` — grants, local-pane policy, dialogs, resolution
- `src/main/backendHandshake.ts` — `routeBackendMessage`
- `backend/src/services/host-bridge.service.ts`, `backend/src/services/local-grant.service.ts` — the backend side
- `backend/src/controllers/sftp.controller.ts` — request schemas
- `SRS_SSH_Desktop_App.md §17 BL-47` — the work item
- `ADR-005` — the utility process and its parent port
