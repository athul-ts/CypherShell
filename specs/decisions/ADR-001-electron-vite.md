# ADR-001 — Use electron-vite as the build toolchain

**Date:** 2026-05-01
**Status:** Accepted
**Deciders:** Athul T S

---

## Context

CypherShell is a desktop app built with Electron. The renderer (UI) layer needs a modern build tool. The main candidates considered were:

1. **electron-vite** — purpose-built Vite wrapper for Electron
2. **Next.js** — React framework with SSR, Server Components, API Routes
3. **Create React App (CRA)** — standard React SPA scaffold (deprecated)
4. **Plain Vite** — without the Electron-specific wrapper

## Decision

Use **electron-vite v5**.

## Reasoning

Next.js was explicitly considered and rejected. Every feature that makes Next.js valuable — SSR, Server Components, Server Actions, API Routes, Image Optimization, `<Link>` prefetching — is completely useless inside an Electron shell. Electron loads the renderer via a local `file://` URL, so there is no HTTP server and no route-based server rendering. Using Next.js would mean paying its full weight (build complexity, `app/` router conventions, multiple compilation stages) while using it as nothing more than a plain React SPA.

CRA is deprecated and has no active maintenance path.

Plain Vite would require manual configuration for the main process, preload scripts, and IPC bridge — electron-vite handles all three in a single unified `electron.vite.config.ts`.

electron-vite is the community-standard build toolchain for Electron + Vite + React. It provides:

- Unified config for main process, preload, and renderer
- HMR (Hot Module Replacement) in dev mode for all three layers
- Correct external/bundle handling for Node built-ins and Electron APIs
- Out-of-the-box TypeScript support
- `@renderer` alias that resolves correctly from both dev and production paths

## Consequences

- **Positive:** Fast dev iteration with HMR across all three Electron processes
- **Positive:** No config debt — the build just works for packaging with electron-builder
- **Negative:** `HashRouter` is required in React Router because the renderer loads as `file://` — `BrowserRouter` does not work without a web server
- **Negative:** Path aliases must be configured in both `electron.vite.config.ts` and the relevant `tsconfig.json` files

## Related

- `electron.vite.config.ts` — the unified build config
- `SRS_SSH_Desktop_App.md §1.3` — "Why This Stack (Not Next.js)"
