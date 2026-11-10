import { Request, Response } from 'express'
import { SSHService } from '../services/ssh.service'

export function getSessions(_req: Request, res: Response): void {
  res.json({ sessions: SSHService.listSessions() })
}

/**
 * Reports whether the session is still open and renews its heartbeat lease,
 * so an open Profile Detail tab or SFTP window keeps it alive (BL-11).
 */
export function getSessionStatus(req: Request, res: Response): void {
  const sessionId = req.params.sessionId as string
  res.json({ alive: SSHService.heartbeat(sessionId) })
}

export function disconnectSession(req: Request, res: Response): void {
  const sessionId = req.params.sessionId as string
  SSHService.removeSession(sessionId)
  res.json({ success: true })
}
