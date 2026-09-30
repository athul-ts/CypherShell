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

function verifyToken(token: string): JwtPayload {
  const payload = jwt.verify(token, env.jwtSecret) as JwtPayload

  // Reject revoked tokens (SEC-06)
  if (payload.jti && !TokenStore.validate(payload.jti)) {
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
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query.token as string | undefined)

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
