import { Request, Response } from 'express'
import { z } from 'zod'
import { TunnelService } from '../services/tunnel.service'

// ─── BL-23: request validation ──────────────────────────────────────────────

/** A TCP port. The Profile Details form sends ports as digit strings, so both forms are accepted. */
const port = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d{1,5}$/, 'Port must be a number')
  ])
  .transform(Number)
  .pipe(z.number().int().min(1, 'Port must be 1–65535').max(65535, 'Port must be 1–65535'))

/** A host name or address: no whitespace or control characters. */
const host = z
  .string()
  .trim()
  .min(1, 'Remote host required')
  .max(255, 'Remote host is too long')
  .refine(
    (value) => Array.from(value).every((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f),
    'Invalid remote host'
  )

const StartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('local'), localPort: port, remoteHost: host, remotePort: port }),
  z.object({ type: z.literal('remote'), localPort: port, remotePort: port }),
  z.object({ type: z.literal('dynamic'), localPort: port })
])

/** `port` is the local port for local and dynamic forwards, the remote port for remote ones (§9.8). */
const StopSchema = z.object({ type: z.enum(['local', 'remote', 'dynamic']), port })

function badRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' })
}

export async function startForward(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId as string
  const body = StartSchema.safeParse(req.body)
  if (!body.success) return badRequest(res, body.error)
  const forward = body.data

  try {
    if (forward.type === 'local') {
      await TunnelService.startLocalForward(
        sessionId,
        forward.localPort,
        forward.remoteHost,
        forward.remotePort
      )
    } else if (forward.type === 'remote') {
      await TunnelService.startRemoteForward(
        sessionId,
        forward.remotePort,
        '127.0.0.1',
        forward.localPort
      )
    } else {
      await TunnelService.startDynamicForward(sessionId, forward.localPort)
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
  const body = StopSchema.safeParse(req.body)
  if (!body.success) return badRequest(res, body.error)
  const { type, port: forwardPort } = body.data

  try {
    if (type === 'local') {
      await TunnelService.stopLocalForward(sessionId, forwardPort)
    } else if (type === 'remote') {
      await TunnelService.stopRemoteForward(sessionId, forwardPort)
    } else {
      await TunnelService.stopDynamicForward(sessionId, forwardPort)
    }
    res.json({ success: true })
  } catch (error: unknown) {
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to stop forward' })
  }
}
