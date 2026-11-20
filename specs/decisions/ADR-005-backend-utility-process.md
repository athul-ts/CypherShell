# ADR-005 — Run the backend in an Electron utility process and lock down the runtime with fuses

**Date:** 2026-11-20
**Status:** Proposed
**Deciders:** Athul T S

---

## Context

The Express backend is started by the main process as a child process of the app's own executable:

```ts
spawn(process.execPath, [backendScript], { env: { ELECTRON_RUN_AS_NODE: '1', STORAGE_KEY, LAUNCH_SECRET, … } })
```

`ELECTRON_RUN_AS_NODE` turns the signed `CypherShell.exe` into a general-purpose Node.js runtime. That has three consequences:

1. **The Electron `RunAsNode` fuse has to stay on.** With it on, anyone who can run the installed binary can start it with `ELECTRON_RUN_AS_NODE=1` and execute arbitrary JavaScript under the application's identity — a ready-made "living off the land" binary that is signed by us. The same runtime also honours `NODE_OPTIONS` and `--inspect`, which the matching fuses would turn off.
2. **Two secrets travel in environment variables.** `STORAGE_KEY` (the per-install key that protects data when app lock is off) and `LAUNCH_SECRET` (BL-17) are readable by same-user processes through the environment block for the lifetime of the backend.
3. **No fuse hardening is possible.** The application ships with Electron's default fuses: `runAsNode` on, `NODE_OPTIONS` honoured, `--inspect` allowed, no ASAR integrity check.

Constraints:

- The backend must stay a separate process (ADR-002): a crash or a blocked event loop in it must not take down the window, and the existing supervisor restarts it.
- `better-sqlite3` and `ssh2`'s native modules are built for the Electron ABI and live outside the ASAR (`extraResources`).
- The renderer talks to the backend over HTTP and WebSocket on `127.0.0.1`; that does not change.
- macOS and Linux cannot be built or run on the development machine; they are verified in CI only.

Alternatives considered:

- **Keep `ELECTRON_RUN_AS_NODE`** and accept the exposure. No work, but the findings above remain, and the fuses stay off.
- **Run the backend inside the main process.** Removes the second process, but loses crash isolation and puts every SSH session on the main thread that also serves the UI and IPC.
- **`worker_threads` in the main process.** Isolates the event loop but not a crash of a native module, and shares the main process's memory with the SSH keys.
- **Ship a separate Node.js binary for the backend.** Removes the dependency on Electron's runtime, but adds ~40 MB per platform and a second runtime to patch.

---

## Decision

Start the backend with Electron's `utilityProcess.fork`, send its secrets in the first message rather than the environment, and turn the `RunAsNode`, `NODE_OPTIONS` and `--inspect` fuses off while turning ASAR integrity and `onlyLoadAppFromAsar` on.

---

## Reasoning

- `utilityProcess` is Electron's supported way to run Node.js code in a separate process; it does not use `ELECTRON_RUN_AS_NODE`, so the fuse can be disabled without breaking the backend.
- A message to a process we just started cannot be read by other processes the way an environment block can, so the two secrets are no longer exposed to same-user observers.
- Disabling the Node-mode fuses removes the signed-binary-as-a-Node-runtime path and the `NODE_OPTIONS` / inspector injection points. ASAR integrity makes tampering with the packaged renderer and main code detectable at start-up.
- The change keeps ADR-002's structure (separate process, supervisor restart, HTTP/WebSocket to the renderer), so the renderer, the API and all backend tests are unaffected.
- Accepted trade-off: backend logs now arrive through the utility process's piped stdout/stderr instead of the child's; `process.send`-based host messages move to `process.parentPort`, with the existing `process.send` path kept for tests.

---

## Consequences

- **Positive:** the packaged binary can no longer be used as a Node.js interpreter.
- **Positive:** `STORAGE_KEY` and `LAUNCH_SECRET` no longer appear in the backend's environment.
- **Positive:** modified application code inside the ASAR is detected at start-up.
- **Negative:** a more involved start-up path (message hand-shake before the backend listens) and a supervisor that must handle the utility process's `exit` event instead of a child process's.
- **Negative:** ASAR integrity validation covers Windows and macOS only, and the fuses are applied at packaging time, so a development run does not exercise them — the packaged build must be smoke-tested.
- **Negative:** developing against a utility process makes attaching a debugger to the backend less direct than `node --inspect`.

**To verify in BL-46 before this ADR moves to Accepted** (not yet tested):

1. A utility process can run `resources/backend/dist/index.js`, which lives outside the ASAR, with `better-sqlite3` and `ssh2` loading from `resources/backend/node_modules`.
2. `onlyLoadAppFromAsar` does not block that path, and the `file://` renderer still loads with `grantFileProtocolExtraPrivileges` off.
3. `process.parentPort` is available to the backend and delivers the first message before the server listens.
4. Windows packaging with the fuses set starts and passes the e2e smoke test; macOS and Linux packaging pass `package.yml`.

---

## Related

- `src/main/index.ts` — backend spawn, secrets, supervisor wiring
- `src/main/backendSupervisor.ts` — restart logic
- `backend/src/services/host-bridge.service.ts` — main ↔ backend messages
- `electron-builder.yml` — fuse settings
- `SRS_SSH_Desktop_App.md §17 BL-46` — the work item
- `ADR-002` — Express as a separate process (kept)
- `ADR-004` — release pipeline that packages the result
