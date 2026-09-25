Perform a security review of a specific file or feature area in CypherShell.

The user will specify what to review: **$ARGUMENTS** (e.g. "SFTP file operations" or "auth.controller.ts")

Check for all of the following:

1. **Path traversal** — any `fs` call using a user-supplied path must be validated against an allowed base directory
2. **JWT bypass** — every route except `POST /api/auth/unlock` and `POST /api/auth/setup` must have `authMiddleware`
3. **Input validation** — all request bodies must be validated with Zod before use
4. **Crypto misuse** — passwords/keys must only be encrypted/decrypted via `crypto.service.ts`; no raw `crypto` calls elsewhere
5. **Memory leaks** — SSH sessions and SFTP clients must be closed on disconnect/error
6. **IPC attack surface** — preload must only expose the specific channels listed in `src/preload/index.ts`; no `ipcRenderer.on('*')` wildcards
7. **Electron webPreferences** — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` must remain set
8. **XSS in terminal** — xterm.js renders raw bytes; confirm no user-controlled data is injected as HTML
9. **Dependency confusion** — flag any `require()` using a dynamic string built from user input

Report findings as: [CRITICAL / HIGH / MEDIUM / LOW / INFO] with the file path, line number, and recommended fix.
