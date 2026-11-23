import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { TokenStore } from '../services/token-store.service'

interface JwtPayload {
  session: string
  jti?: string
  iat?: number
  exp?: number
}

/**
 * Verifies a session token for every transport — REST, SSE and the terminal
 * WebSocket (BL-18). Throws when the token is invalid.
 *
 * BL-19: only HS256 is accepted, and every token must carry a `jti` that is
 * still in the TokenStore. A token without one could never be revoked by a
 * lock, so it is refused rather than trusted.
 */
export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] })
  if (typeof decoded === 'string') throw new Error('Unexpected token payload')
  const payload = decoded as JwtPayload

  // Reject revoked tokens and tokens that cannot be revoked (SEC-06, BL-19)
  if (typeof payload.jti !== 'string' || !TokenStore.validate(payload.jti)) {
    throw new Error('Token revoked')
  }

  return payload
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const token = authHeader.slice(7)
  try {
    verifyToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/**
 * Same as requireAuth but also accepts the token via ?token= query param.
 * Needed for EventSource / SSE connections which cannot send custom headers.
 */
export function requireAuthFlexible(req: Request, res: Response, next: NextFunction): void {
  // Prefer header, fall back to query string for EventSource compatibility
  const authHeader = req.headers.authorization
  const queryToken = req.query.token
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : typeof queryToken === 'string'
      ? queryToken
      : undefined

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    verifyToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
