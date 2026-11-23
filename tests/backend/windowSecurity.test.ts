/**
 * [NFR-02][BL-21] Window hardening decisions: which pages are the app's, which
 * links may leave it, and which IPC senders are served.
 *
 * Regression: only the main window denied `window.open`. In terminal
 * windows xterm's link handler opened the link in a new Electron window that
 * inherited the preload, so any page linked from terminal output got
 * `window.api`.
 */
import { describe, it, expect } from 'vitest'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  externalUrlToOpen,
  isAppRendererUrl,
  isTrustedSenderFrame,
  type RendererLocation
} from '../../src/main/windowSecurity'

const indexHtmlPath = path.join(os.tmpdir(), 'CypherShell', 'out', 'renderer', 'index.html')
const packaged: RendererLocation = { indexHtmlPath }
const dev: RendererLocation = { devServerUrl: 'http://localhost:5173', indexHtmlPath }
const appPage = pathToFileURL(indexHtmlPath).href

describe('[BL-21] the app renderer', () => {
  it('is the packaged index.html, with any hash route or query', () => {
    expect(isAppRendererUrl(appPage, packaged)).toBe(true)
    expect(isAppRendererUrl(`${appPage}#/connection/terminal/s1?profileId=p`, packaged)).toBe(true)
    expect(isAppRendererUrl(`${appPage}?x=1`, packaged)).toBe(true)
  })

  it('excludes other files and every remote page', () => {
    const other = pathToFileURL(path.join(path.dirname(indexHtmlPath), 'evil.html')).href
    for (const url of [
      other,
      'https://attacker.example/',
      'http://127.0.0.1:4000/api/audit/export',
      'about:blank',
      'not a url'
    ]) {
      expect(isAppRendererUrl(url, packaged)).toBe(false)
    }
  })

  it('in dev is the dev server origin only', () => {
    expect(isAppRendererUrl('http://localhost:5173/#/keys', dev)).toBe(true)
    expect(isAppRendererUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppRendererUrl(appPage, dev)).toBe(false)
  })

  it('compares paths case-insensitively on Windows only', () => {
    const upper = pathToFileURL(indexHtmlPath.toUpperCase()).href
    expect(isAppRendererUrl(upper, packaged, 'win32')).toBe(true)
    expect(isAppRendererUrl(upper, packaged, 'linux')).toBe(false)
  })
})

describe('[BL-21] window.open', () => {
  it('sends http(s) links to the system browser', () => {
    expect(externalUrlToOpen('https://example.com/docs?a=1')).toBe('https://example.com/docs?a=1')
    expect(externalUrlToOpen('http://example.com')).toBe('http://example.com/')
  })

  it('drops every other scheme, including the blank window xterm opens by default', () => {
    for (const url of [
      'about:blank',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ms-settings:',
      'smb://host/share',
      ''
    ]) {
      expect(externalUrlToOpen(url)).toBeNull()
    }
  })
})

describe('[BL-21] IPC senders', () => {
  it('serves a top-level frame showing the app', () => {
    expect(isTrustedSenderFrame({ url: appPage, parent: null }, packaged)).toBe(true)
  })

  it('refuses subframes, foreign pages and closed frames', () => {
    expect(isTrustedSenderFrame({ url: appPage, parent: {} }, packaged)).toBe(false)
    expect(isTrustedSenderFrame({ url: 'https://attacker.example', parent: null }, packaged)).toBe(
      false
    )
    expect(isTrustedSenderFrame(null, packaged)).toBe(false)
  })
})
