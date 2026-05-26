import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  try {
    jwt.verify(token, env.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Same as requireAuth but also accepts the token via ?token= query param.
 * Needed for EventSource / SSE connections which cannot send custom headers.
 */
export function requireAuthFlexible(req: Request, res: Response, next: NextFunction) {
  // Prefer header, fall back to query string for EventSource compatibility
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query.token as string | undefined);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    jwt.verify(token, env.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
