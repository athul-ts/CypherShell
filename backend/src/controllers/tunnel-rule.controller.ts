import { Request, Response } from 'express'
import { z } from 'zod'
import { HostSchema, PortSchema } from './tunnel.controller'
import {
  DuplicateTunnelRuleError,
  ProfileNotFoundError,
  TunnelRuleService,
  type TunnelRuleInput
} from '../services/tunnel-rule.service'

const label = z
  .string()
  .trim()
  .max(80, 'Label is too long')
  .transform((value) => value || null)
  .nullish()
  .transform((value) => value ?? null)

/** The same fields the tunnel start API takes, plus an optional label (BL-34). */
const RuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local'),
    localPort: PortSchema,
    remoteHost: HostSchema,
    remotePort: PortSchema,
    label
  }),
  z.object({ type: z.literal('remote'), localPort: PortSchema, remotePort: PortSchema, label }),
  z.object({ type: z.literal('dynamic'), localPort: PortSchema, label })
])

function toInput(rule: z.infer<typeof RuleSchema>): TunnelRuleInput {
  return {
    type: rule.type,
    localPort: rule.localPort,
    remoteHost: rule.type === 'local' ? rule.remoteHost : null,
    remotePort: rule.type === 'dynamic' ? null : rule.remotePort,
    label: rule.label
  }
}

function fail(res: Response, error: unknown, fallback: string): void {
  if (error instanceof ProfileNotFoundError) {
    res.status(404).json({ error: error.message })
  } else if (error instanceof DuplicateTunnelRuleError) {
    res.status(409).json({ error: error.message })
  } else {
    res.status(500).json({ error: error instanceof Error ? error.message : fallback })
  }
}

export async function listTunnelRules(req: Request, res: Response): Promise<void> {
  try {
    res.json(await TunnelRuleService.list(req.params.id as string))
  } catch (error: unknown) {
    fail(res, error, 'Failed to list saved tunnels')
  }
}

export async function createTunnelRule(req: Request, res: Response): Promise<void> {
  const body = RuleSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid request' })
    return
  }
  try {
    res
      .status(201)
      .json(await TunnelRuleService.create(req.params.id as string, toInput(body.data)))
  } catch (error: unknown) {
    fail(res, error, 'Failed to save tunnel')
  }
}

export async function deleteTunnelRule(req: Request, res: Response): Promise<void> {
  try {
    const removed = await TunnelRuleService.remove(
      req.params.id as string,
      req.params.tunnelId as string
    )
    if (!removed) {
      res.status(404).json({ error: 'Saved tunnel not found' })
      return
    }
    res.json({ success: true })
  } catch (error: unknown) {
    fail(res, error, 'Failed to delete saved tunnel')
  }
}
