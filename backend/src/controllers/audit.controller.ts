import { Request, Response } from 'express'
import { z } from 'zod'
import { AUDIT_TYPES, AuditService } from '../services/audit.service'

/** FR-08.5: server-side paging and filters. Dates are ISO strings from the renderer. */
const LogQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be 1 or more').default(1),
  pageSize: z.coerce.number().int().min(1).max(200, 'pageSize is at most 200').default(50),
  type: z.enum(AUDIT_TYPES).optional(),
  from: z.coerce.date({ error: 'from must be a date' }).optional(),
  to: z.coerce.date({ error: 'to must be a date' }).optional(),
  q: z.string().trim().max(200, 'q is too long').optional()
})

export async function clearAllLogs(_req: Request, res: Response): Promise<void> {
  try {
    await AuditService.clearAllLogs()
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

export async function getLogs(req: Request, res: Response): Promise<void> {
  const query = LogQuerySchema.safeParse(req.query)
  if (!query.success) {
    res.status(400).json({ error: query.error.issues[0]?.message ?? 'Invalid request' })
    return
  }
  try {
    res.json(await AuditService.queryLogs({ ...query.data, q: query.data.q || undefined }))
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
