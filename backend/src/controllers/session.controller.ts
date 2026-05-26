import { Request, Response } from 'express';
import { SSHService } from '../services/ssh.service';

export function getSessions(req: Request, res: Response) {
  // Not fully implemented, could return all session IDs
  res.json({ sessions: [] });
}

export function disconnectSession(req: Request, res: Response) {
  const sessionId = req.params.sessionId as string;
  SSHService.removeSession(sessionId);
  res.json({ success: true });
}
