import { Request, Response } from 'express'
import { AuditService } from '../services/audit.service'

export async function clearAllLogs(_req: Request, res: Response): Promise<void> {
  try {
    await AuditService.clearAllLogs()
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

export async function getLogs(req: Request, res: Response): Promise<void> {
  try {
    const limit = parseInt(req.query.limit as string) || 100
    const logs = await AuditService.getLogs(limit)
    res.json(logs)
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

export async function exportLogs(_req: Request, res: Response): Promise<void> {
  try {
    const csv = await AuditService.exportCSV()
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.csv"')
    res.send(csv)
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}
