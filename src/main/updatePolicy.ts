/**
 * How the in-app updater behaves per platform (NFR-07, BL-24).
 *
 * macOS builds are unsigned (ADR-004) and Squirrel.Mac installs only an
 * update signed like the running app, so on darwin the updater only
 * announces a new version and links to the Releases page. Windows and Linux
 * download in the background and install on restart.
 *
 * Pure, so it is unit-tested on any platform.
 */

/** Where macOS users download a new version. Fixed here — the renderer cannot change it. */
export const RELEASES_URL = 'https://github.com/athul-ts/CypherShell/releases/latest'

export interface UpdatePolicy {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  /** The user downloads the update from the Releases page. */
  manual: boolean
}

export function updatePolicyFor(platform: string): UpdatePolicy {
  const manual = platform === 'darwin'
  return { autoDownload: !manual, autoInstallOnAppQuit: !manual, manual }
}
