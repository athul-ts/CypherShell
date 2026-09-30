import { Request, Response } from 'express'
import { TunnelService } from '../services/tunnel.service'

export async function startForward(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const { type, localPort, remoteHost, remotePort } = req.body

  try {
    if (type === 'local') {
      await TunnelService.startLocalForward(
        sessionId,
        Number(localPort),
        remoteHost,
        Number(remotePort)
      )
    } else if (type === 'remote') {
      await TunnelService.startRemoteForward(
        sessionId,
        Number(remotePort),
        '127.0.0.1',
        Number(localPort)
      )
    } else if (type === 'dynamic') {
      await TunnelService.startDynamicForward(sessionId, Number(localPort))
    } else {
      throw new Error('Unsupported forward type. Use local, remote, or dynamic.')
    }
    res.json({ success: true })
  } catch (error: unknown) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to start forward' })
  }
}

export async function stopForward(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const { type, port } = req.body // port is localPort for local, remotePort for remote

  try {
    if (type === 'local') {
      await TunnelService.stopLocalForward(sessionId, Number(port))
    } else if (type === 'remote') {
      await TunnelService.stopRemoteForward(sessionId, Number(port))
    } else if (type === 'dynamic') {
      await TunnelService.stopDynamicForward(sessionId, Number(port))
    }
    res.json({ success: true })
  } catch (error: unknown) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to stop forward' })
  }
}
