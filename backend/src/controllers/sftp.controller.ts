import { Request, Response } from 'express';
import { SftpService } from '../services/sftp.service';

export async function listDirectory(req: Request, res: Response) {
  const sessionId = req.params.sessionId as string;
  const targetPath = req.query.path as string || '.';
  
  try {
    const files = await SftpService.list(sessionId, targetPath);
    res.json({ files });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'SFTP list failed' });
  }
}

export async function uploadFile(req: Request, res: Response) {
  const sessionId = req.params.sessionId as string;
  const { localPath, remotePath, transferId } = req.body;
  
  SftpService.upload(sessionId, localPath, remotePath, transferId).catch(console.error);
  res.json({ success: true, transferId });
}

export async function downloadFile(req: Request, res: Response) {
  const sessionId = req.params.sessionId as string;
  const { remotePath, localPath, transferId } = req.body;
  
  SftpService.download(sessionId, remotePath, localPath, transferId).catch(console.error);
  res.json({ success: true, transferId });
}

export async function deleteFile(req: Request, res: Response) {
  const sessionId = req.params.sessionId as string;
  const { remotePath } = req.body;
  
  try {
    await SftpService.deleteFile(sessionId, remotePath);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete file' });
  }
}

export async function renameFile(req: Request, res: Response) {
  const sessionId = req.params.sessionId as string;
  const { oldPath, newPath } = req.body;
  
  try {
    await SftpService.renameFile(sessionId, oldPath, newPath);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to rename file' });
  }
}

export async function createDirectory(req: Request, res: Response) {
  const sessionId = req.params.sessionId as string;
  const { remotePath } = req.body;
  
  try {
    await SftpService.createDirectory(sessionId, remotePath);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create directory' });
  }
}

export async function changePermissions(req: Request, res: Response) {
  const sessionId = req.params.sessionId as string;
  const { remotePath, mode } = req.body;
  
  try {
    // Mode is sent as a string representation of octal (e.g. '755') or a number. Parse appropriately.
    const numericMode = typeof mode === 'string' ? parseInt(mode, 8) : mode;
    await SftpService.changePermissions(sessionId, remotePath, numericMode);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to change permissions' });
  }
}

export function progressStream(req: Request, res: Response) {
  const transferId = req.params.transferId as string;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onProgress = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (data.status === 'complete' || data.status === 'error' || data.status === 'cancelled') {
      SftpService.transferEvents.off(transferId, onProgress);
    }
  };

  SftpService.transferEvents.on(transferId, onProgress);

  req.on('close', () => {
    SftpService.transferEvents.off(transferId, onProgress);
  });
}

export async function cancelTransfer(req: Request, res: Response) {
  const transferId = req.params['transferId'] as string;
  SftpService.cancelTransfer(transferId);
  res.json({ success: true });
}
