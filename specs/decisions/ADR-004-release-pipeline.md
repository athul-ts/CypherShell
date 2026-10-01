# ADR-004 — Reusable matrix release pipeline

**Date:** 2026-09-30
**Status:** Accepted
**Deciders:** Athul T S

---

## Context

CypherShell targets Windows, macOS, and Linux (NFR-05, NFR-07), and its `electron-builder.yml`
has configured all three platforms since Phase 5. The original CI release workflow, however, was
written as one hand-authored job per platform — a `build-win` job and a `build-linux` job — and
**macOS was never added**. The macOS configuration existed but was dead: no job exercised it, so
no `.dmg` was ever produced, while `SRS_SSH_Desktop_App.md` §16 reported "Win/Mac/Linux
installers ✅ Complete".

Three further defects followed from the same per-platform hand-authoring:

1. The artifact upload globs were written per job (`dist/*.exe`, `dist/*.AppImage`, `dist/*.deb`)
   and none of them matched `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, or `*.blockmap`.
   The in-app auto-updater (`electron-updater`, driven by `src/main/index.ts`) resolves its feed
   from those files, so update checks could never succeed against a CI-published Release — a
   silent failure, because the app simply logged an error and carried on.
2. `scripts/after-pack.cjs` rebuilt the `better-sqlite3` native module without passing an
   architecture, so it built for the _runner's_ arch. On an Apple Silicon runner the x64 macOS
   bundle would have embedded an arm64 `.node` binary and crashed on launch.
3. `dmg.artifactName` had no `${arch}` placeholder, so the x64 and arm64 dmgs would have written
   the same filename and overwritten each other.

The alternatives considered were: (a) keep the per-platform hand-authored jobs and add a third
macOS job; (b) replace them with a single matrix job inside the release workflow; (c) extract a
reusable `workflow_call` matrix workflow shared by the release and PR workflows.

## Decision

Use **a single reusable matrix workflow (`.github/workflows/build.yml`)** that builds all
platforms, called by both the release workflow and a PR packaging workflow.

macOS builds ship **unsigned and un-notarized** in v1.

## Reasoning

Option (a) is what produced the defect: when each platform is a separate hand-written job, the
set of platforms is implicit in the job list, and omitting one is invisible — nothing fails,
nothing warns, the Release is simply missing an artifact. The same hand-authoring is what let the
artifact globs drift out of sync with what `electron-builder` actually emits. A matrix makes the
platform list a single explicit data structure, so a missing platform is a visible gap rather
than an absence.

Option (b) would fix the release path but leave PRs unverified. Packaging failures specific to
macOS or Linux cannot be reproduced on a Windows development machine, so discovering them only at
merge time means a broken Release is the first signal — after the tag exists. Extracting the
matrix into a `workflow_call` workflow (option (c)) lets PRs run the identical build, which is
the point: it must be the same workflow, not a parallel copy that can drift.

Two consequences of the matrix are deliberate:

- The upload step uses `if-no-files-found: error`, so a platform that produces nothing fails
  loudly. This is the guard that would have caught the original missing-macOS defect.
- The arch passed to `after-pack.cjs` is asserted against the built binary (`lipo -archs` on
  macOS). Architecture mismatches cannot be caught by a successful build — they only surface as a
  crash on a user's machine — so the assertion converts a silent runtime failure into a build
  failure.

**On unsigned macOS builds:** signing requires an Apple Developer Program membership and
notarization requires Apple credentials in CI. Neither is justified while the project has no
external macOS users. The accepted cost is that Gatekeeper blocks the first launch.

**Correction (2026-10-01):** this section originally recorded that "the README documents the
right-click → **Open** workaround." That was accurate when written, but the workaround **no longer
works** — Apple removed the Control-click override in macOS 15 Sequoia:

> In macOS Sequoia, users will no longer be able to Control-click to override Gatekeeper when
> opening software that isn't signed correctly or notarized. They'll need to visit System Settings
> \> Privacy & Security to review security information for software before allowing it to run.

The decision to ship macOS unsigned is unchanged — only the recorded mitigation had gone stale. The
replacement route, now documented in the README, the Release notes, and `NFR-07`, is **System
Settings → Privacy & Security → Security → Open Anyway**, or
`xattr -dr com.apple.quarantine /Applications/CypherShell.app`. Any text recommending right-click →
**Open** is stale and should be corrected on sight.

Adding signing later is a secrets-only change (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, plus `notarize: true`) and does not alter this
decision's structure.

**On cross-compilation:** `better-sqlite3` is built for both macOS architectures on the single
arm64 `macos-latest` runner. `@electron/rebuild` forwards the requested arch to
`prebuild-install`/`node-gyp`, and macOS toolchains target either architecture. If this proves
unreliable, the fallback is to split macOS into two matrix rows (`macos-15-intel` for x64,
`macos-latest` for arm64) — a matrix edit, which is the intended shape of this design.

## Consequences

- **Positive:** The platform list is one explicit matrix; adding a platform is one row.
- **Positive:** PRs build the identical three-platform matrix, so packaging regressions are caught before merge.
- **Positive:** Release and PR builds share one workflow, so they cannot drift apart.
- **Positive:** Auto-update metadata and blockmaps reach the Release, making `electron-updater` functional.
- **Positive:** Architecture mismatches in native modules fail the build instead of crashing at runtime.
- **Negative:** PR pushes now run three packaging legs (~10 min each), consuming CI minutes that the previous typecheck/lint/test-only CI did not.
- **Negative:** Unsigned macOS builds present a Gatekeeper warning and require a manual override on first launch. This cost is not fixed — Apple removed the Control-click → **Open** shortcut in macOS 15 Sequoia, forcing users into System Settings, and may tighten the policy further. Each such change silently invalidates the documented workaround until it is rewritten.
- **Negative:** The reusable workflow (`workflow_call`) cannot be triggered directly from the GitHub UI; ad-hoc builds go through the `workflow_dispatch` entry point in the packaging workflow instead.
- **Negative:** macOS is built on an arm64 runner for both architectures, which depends on `@electron/rebuild` cross-arch support holding.

## Related

- `.github/workflows/build.yml` — the reusable matrix workflow
- `.github/workflows/release.yml` — calls it on merge to `main`, publishes the Release
- `.github/workflows/package.yml` — calls it on PRs and via manual dispatch
- `scripts/after-pack.cjs` — per-arch native rebuild + architecture assertion
- `electron-builder.yml` — per-platform targets, mac `.zip` target, per-arch artifact names
- `SRS_SSH_Desktop_App.md §7 NFR-07` — Release & Distribution requirement
- `SRS_SSH_Desktop_App.md §15` — Known Risks (packaging)
- `ADR-003` — `better-sqlite3` native module strategy that this pipeline must accommodate
