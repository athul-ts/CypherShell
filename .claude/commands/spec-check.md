Audit the CypherShell codebase against the spec and report any drift.

This command checks for two types of drift:
1. **Missing implementation** — spec says ✅ but the code doesn't actually do it
2. **Undocumented code** — code exists for something not tracked in the spec

## Step 1 — Read the spec index
Read `specs/index.md` completely to get the full list of IDs and their claimed statuses.

## Step 2 — Verify each ✅ item is actually implemented
For each item marked ✅ in the index, perform a targeted code check:

| Spec area | Where to check |
|---|---|
| FR-01 (Profiles) | `src/renderer/src/pages/Home.tsx`, `ProfileDetailPane.tsx`, `ProfileForm.tsx`, `backend/src/routes/profile.routes.ts` |
| FR-02 (Terminal) | `src/renderer/src/pages/Terminal.tsx`, `TerminalPane.tsx`, `backend/src/websocket/terminal.ws.ts` |
| FR-03 (Tabs) | `src/renderer/src/store/tabStore.ts`, `TabBar.tsx` |
| FR-04 (SFTP) | `SftpPane.tsx`, `LocalFilePane.tsx`, `backend/src/routes/sftp.routes.ts`, `sftp.service.ts` |
| FR-05 (Keys) | `src/renderer/src/pages/Keys.tsx`, `backend/src/routes/key.routes.ts`, `key.service.ts` |
| FR-06 (Tunnels) | `TunnelModal.tsx`, `backend/src/routes/tunnel.routes.ts`, `tunnel.service.ts` |
| FR-07 (App Lock) | `SetupWizard.tsx`, `LockScreen.tsx`, `backend/src/controllers/auth.controller.ts` |
| FR-08 (Audit) | `src/renderer/src/pages/Logs.tsx`, `backend/src/routes/audit.routes.ts`, `audit.service.ts` |
| NFR-02 (Security) | `auth.middleware.ts`, `crypto.service.ts`, `src/main/index.ts` (webPreferences) |

## Step 3 — Check for undocumented features
Scan `backend/src/routes/` for any route that does not correspond to a spec item.
Scan `src/renderer/src/pages/` for any page not referenced in the spec.

## Step 4 — Report
Produce a drift report with three sections:

### Spec Drift Report

**False ✅ (claimed done, not actually implemented):**
| ID | Issue | Evidence |
|---|---|---|

**True gaps (❌/⚠️ items — confirmed not implemented):**
| ID | Gap | Priority |
|---|---|---|

**Undocumented code (code exists, no spec item):**
| File / Route | What it does | Suggested spec ID |
|---|---|---|

**No drift found:**
If everything matches, confirm: "Spec and implementation are in sync. No drift detected."
