/**
 * URL decisions for window hardening (§10.7, BL-21): which pages belong to
 * the app, which links may leave it, and which IPC senders are served.
 *
 * Deliberately free of Electron imports so the rules can be unit-tested.
 */
import { resolve } from 'path'
import { fileURLToPath } from 'url'

export interface RendererLocation {
  /** The electron-vite dev server URL, when the renderer is served from it. */
  devServerUrl?: string
  /** Absolute path of the packaged renderer's index.html. */
  indexHtmlPath: string
}

/** True when `url` is a page of the app's own renderer (any hash route or query). */
export function isAppRendererUrl(
  url: string,
  location: RendererLocation,
  platform: NodeJS.Platform = process.platform
): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (location.devServerUrl) {
    try {
      return parsed.origin === new URL(location.devServerUrl).origin
    } catch {
      return false
    }
  }
  if (parsed.protocol !== 'file:') return false
  let filePath: string
  try {
    filePath = fileURLToPath(parsed)
  } catch {
    return false
  }
  const expected = resolve(location.indexHtmlPath)
  return platform === 'win32'
    ? filePath.toLowerCase() === expected.toLowerCase()
    : filePath === expected
}

/**
 * What a `window.open` may do: an http(s) URL is opened in the system
 * browser; everything else (file:, javascript:, custom schemes, about:blank)
 * is dropped. Returns the URL to open externally, or null.
 */
export function externalUrlToOpen(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** The parts of Electron's `WebFrameMain` the IPC check needs. */
export interface FrameLike {
  url: string
  parent: unknown
}

/** IPC is served only to a top-level frame showing the app's renderer. */
export function isTrustedSenderFrame(
  frame: FrameLike | null | undefined,
  location: RendererLocation,
  platform: NodeJS.Platform = process.platform
): boolean {
  return !!frame && !frame.parent && isAppRendererUrl(frame.url, location, platform)
}
