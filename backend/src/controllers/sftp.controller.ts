import { Request, Response } from 'express'
import { SftpService } from '../services/sftp.service'

// Returns the message from an unknown thrown value, falling back to undefined.
function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

// Progress event payload emitted by SftpService.transferEvents.
interface TransferProgress {
  transferId: string
  status: 'progress' | 'complete' | 'error' | 'cancelled'
  bytesTransferred?: number
  totalBytes?: number
  percent?: number
  message?: string
}

export async function listDirectory(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const targetPath = (req.query.path as string) || '.'
  const showHidden = req.query.showHidden === 'true'

  try {
    const files = await SftpService.list(sessionId, targetPath, showHidden)
    res.json({ files })
  } catch (error: unknown) {
    res.status(500).json({ error: errorMessage(error) || 'SFTP list failed' })
  }
}

export async function uploadFile(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const { localPath, remotePath, transferId } = req.body

  SftpService.upload(sessionId, localPath, remotePath, transferId).catch(console.error)
  res.json({ success: true, transferId })
}

export async function downloadFile(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const { remotePath, localPath, transferId } = req.body

  SftpService.download(sessionId, remotePath, localPath, transferId).catch(console.error)
  res.json({ success: true, transferId })
}

export async function deleteFile(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const { remotePath } = req.body

  try {
    await SftpService.deleteFile(sessionId, remotePath)
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: errorMessage(error) || 'Failed to delete file' })
  }
}

export async function renameFile(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const { oldPath, newPath } = req.body

  try {
    await SftpService.renameFile(sessionId, oldPath, newPath)
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: errorMessage(error) || 'Failed to rename file' })
  }
}

export async function createDirectory(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const { remotePath } = req.body

  try {
    await SftpService.createDirectory(sessionId, remotePath)
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: errorMessage(error) || 'Failed to create directory' })
  }
}

export async function changePermissions(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const { remotePath, mode } = req.body

  try {
    // Mode is sent as a string representation of octal (e.g. '755') or a number. Parse appropriately.
    const numericMode = typeof mode === 'string' ? parseInt(mode, 8) : mode
    await SftpService.changePermissions(sessionId, remotePath, numericMode)
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: errorMessage(error) || 'Failed to change permissions' })
  }
}

export function progressStream(req: Request, res: Response): void {
  const transferId = req.params.transferId as string

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const onProgress = (data: TransferProgress): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
    if (data.status === 'complete' || data.status === 'error' || data.status === 'cancelled') {
      SftpService.transferEvents.off(transferId, onProgress)
    }
  }

  SftpService.transferEvents.on(transferId, onProgress)

  // CODE-06b: Clean up listener on client disconnect
  req.on('close', () => {
    SftpService.transferEvents.off(transferId, onProgress)
  })

  // FUN-19: Idle timeout — auto-close SSE if no progress event within 5 minutes
  // to prevent lingering listeners for orphaned transfers.
  const idleTimeout = setTimeout(
    () => {
      SftpService.transferEvents.off(transferId, onProgress)
      res.end()
    },
    5 * 60 * 1000
  )

  req.on('close', () => clearTimeout(idleTimeout))
}

export async function cancelTransfer(req: Request, res: Response): Promise<void> {
  const transferId = req.params['transferId'] as string
  SftpService.cancelTransfer(transferId)
  res.json({ success: true })
}
