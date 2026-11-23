import { Request, Response } from 'express'
import { KnownHostService } from '../services/known-host.service'
import { AuditService } from '../services/audit.service'

/** BL-38: the trusted SSH host keys, newest `lastSeenAt` first. */
export async function listKnownHosts(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await KnownHostService.list())
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

export async function deleteKnownHost(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string
    const known = await KnownHostService.findById(id)
    if (!known || !(await KnownHostService.remove(id))) {
      res.status(404).json({ error: 'Known host not found' })
      return
    }
    await AuditService.logHostKey(
      null,
      'Known host removed',
      true,
      `${known.keyType} ${known.fingerprint}`,
      `${known.host}:${known.port}`
    )
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}
