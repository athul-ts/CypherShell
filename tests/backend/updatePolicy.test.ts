/**
 * [NFR-07][BL-24] macOS builds are unsigned (ADR-004), so the updater on
 * macOS only announces new versions; Windows and Linux install them.
 *
 * Pure policy — this runs on any CI platform. The behaviour on a real Mac is
 * not verified (no macOS hardware available).
 */
import { describe, it, expect } from 'vitest'
import { RELEASES_URL, updatePolicyFor } from '../../src/main/updatePolicy'

describe('[BL-24] update policy', () => {
  it('never downloads or installs on darwin', () => {
    expect(updatePolicyFor('darwin')).toEqual({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      manual: true
    })
  })

  it.each(['win32', 'linux'])('downloads and installs on %s', (platform) => {
    expect(updatePolicyFor(platform)).toEqual({
      autoDownload: true,
      autoInstallOnAppQuit: true,
      manual: false
    })
  })

  it('points manual updates at the GitHub Releases page', () => {
    expect(RELEASES_URL).toBe('https://github.com/athul-ts/CypherShell/releases/latest')
  })
})
