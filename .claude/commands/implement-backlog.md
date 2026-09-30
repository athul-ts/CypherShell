Implement one of the v1.1 backlog items from `SRS_SSH_Desktop_App.md §17`.

The user will specify the item ID: **$ARGUMENTS** (e.g. "BL-01" or "BL-04")

Before writing any code:

1. Read `SRS_SSH_Desktop_App.md §17` to get the full spec for the requested backlog item
2. Read all files that will need to change (backend routes, controllers, services, frontend components, stores)
3. Confirm the implementation plan in one short paragraph

Then implement in this order:

1. Backend changes (route → controller → service)
2. Frontend changes (store update → component wiring)
3. Run `npm run typecheck` and fix any errors

Backlog reference:

- BL-01: Cancel in-progress SFTP transfer — `DELETE /api/sftp/:sessionId/transfer/:transferId`, `SftpService.cancelTransfer()`, cancel button in `SftpPane.tsx`
- BL-02: Port conflict detection — port probe in `TunnelService.startForward()` + frontend warning
- BL-03: Warn before deleting key used by profiles — pre-delete query + confirmation dialog in `Keys.tsx`
- BL-04: Audit log auto-purge — `setInterval` in `backend/src/index.ts` calling `AuditService.purgeOldLogs()`
- BL-05: SSH disconnect reason logging — capture reason in `terminal.ws.ts` + `AuditService.log()`
- BL-06: DELETE /api/logs endpoint — route + `AuditService.clearAll()` + "Clear All" button in `Logs.tsx`
- BL-07: SFTP keyboard shortcuts — `keydown` listener in `SftpPane.tsx` for F2 (rename) and Ctrl+Shift+N (new folder)
- BL-08: Terminal right-click paste — `contextmenu` event on xterm container in `TerminalPane.tsx`
