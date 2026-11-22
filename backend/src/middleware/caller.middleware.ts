import { timingSafeEqual } from 'crypto'
import type { IncomingMessage } from 'http'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { CorsOptions } from 'cors'
import { Secrets } from '../config/secrets'

/**
 * BL-17: who may call the local API.
 *
 * Measured on Electron 39: the packaged (`file://`) renderer sends no `Origin`
 * header — and no CORS preflight — on fetch, XHR and EventSource, and sends
 * `Origin: file://` on a WebSocket upgrade. Browsers always send `Origin` on
 * cross-origin requests, and pages cannot set `Host`, so:
 *  - `Host` must name the loopback interface (a DNS-rebinding page sends its
 *    own domain),
 *  - an `Origin`, when present, must be `file://` or an exact dev-server
 *    origin (`null`, other localhost ports and every web origin are refused),
 *  - `/api/auth/*` and the terminal WebSocket also need the per-launch secret
 *    that only the main process and its renderers know.
 */
export interface CallerPolicy {
  /** The per-launch secret from the main process. Empty: none configured, auth is refused. */
  launchSecret: string
  /** Exact origins allowed besides `file://` — the electron-vite dev server, in development only. */
  extraOrigins: readonly string[]
}

/** Header that carries the launch secret on REST requests. */
export const LAUNCH_SECRET_HEADER = 'x-cyphershell-launch'

/** The packaged renderer's origin as Electron sends it on WebSocket upgrades. */
const PACKAGED_RENDERER_ORIGIN = 'file://'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** True for a serialized http(s) origin such as `http://localhost:5173`. */
function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
  } catch {
    return false
  }
}

/**
 * Reads the policy from the environment the main process sets: `LAUNCH_SECRET`
 * always, `ALLOWED_CORS_ORIGINS` only in electron-vite dev. Entries that are
 * not exact http(s) origins — `*`, `null`, paths — are dropped.
 */
export function callerPolicyFromEnv(source: NodeJS.ProcessEnv = process.env): CallerPolicy {
  return {
    // BL-46: with the real environment, the secret main sent at start-up (kept in memory) wins.
    launchSecret: source === process.env ? Secrets.launchSecret() : (source.LAUNCH_SECRET ?? ''),
    extraOrigins: (source.ALLOWED_CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(isHttpOrigin)
  }
}

/** True when the `Host` header names this machine's loopback interface (any port). */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase())
}

/**
 * True when the request may come from this `Origin`. No `Origin` means no
 * cross-origin browser context: the packaged renderer, a same-origin `GET`
 * (covered by the Host check) or a non-browser client (still needs the secret
 * or a JWT).
 */
export function isAllowedOrigin(policy: CallerPolicy, origin: string | undefined): boolean {
  if (origin === undefined) return true
  return origin === PACKAGED_RENDERER_ORIGIN || policy.extraOrigins.includes(origin)
}

/** Constant-time comparison against the launch secret; false when none is configured. */
export function hasLaunchSecret(policy: CallerPolicy, presented: unknown): boolean {
  if (!policy.launchSecret || typeof presented !== 'string') return false
  const expected = Buffer.from(policy.launchSecret)
  const actual = Buffer.from(presented)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Refuses (403) requests with a foreign `Host` or `Origin`, before any route runs. */
export function trustedCallerOnly(policy: CallerPolicy): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAllowedHost(req.headers.host)) {
      res.status(403).json({ error: 'Host not allowed' })
      return
    }
    if (!isAllowedOrigin(policy, req.headers.origin)) {
      res.status(403).json({ error: 'Origin not allowed' })
      return
    }
    next()
  }
}

/** Refuses (403) requests that do not carry the launch secret. Mounted on `/api/auth`. */
export function requireLaunchSecret(policy: CallerPolicy): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hasLaunchSecret(policy, req.headers[LAUNCH_SECRET_HEADER])) {
      res.status(403).json({ error: 'Unknown caller' })
      return
    }
    next()
  }
}

/**
 * CORS for the allowed origins only. In practice that is the dev server: the
 * packaged renderer makes no CORS requests at all.
 */
export function corsOptions(policy: CallerPolicy): CorsOptions {
  return {
    origin: (origin, callback) => callback(null, isAllowedOrigin(policy, origin))
  }
}

/**
 * The same Host and Origin rules for a WebSocket upgrade, plus the launch
 * secret as the `launch` query parameter (WebSockets cannot set headers).
 * Returns why the upgrade is refused, or null to let it through.
 */
export function upgradeRefusal(
  policy: CallerPolicy,
  request: IncomingMessage,
  url: URL
): string | null {
  if (!isAllowedHost(request.headers.host)) return 'Host not allowed'
  if (!isAllowedOrigin(policy, request.headers.origin)) return 'Origin not allowed'
  if (!hasLaunchSecret(policy, url.searchParams.get('launch'))) return 'Unknown caller'
  return null
}
