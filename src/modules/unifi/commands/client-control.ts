import type { CommandSpec } from '../../../core/types'
import { blockClient, listClients, readUnifiConfig, reconnectClient, unblockClient } from '../client'
import { integrationClientAction } from '../integration-client'

export const clientsControl: CommandSpec = {
  path: ['client'],
  effect: 'destructive',
  description: 'Control a client: block, unblock, or reconnect by MAC, hostname, or IP',
  args: [
    {
      name: 'action',
      kind: 'positional',
      description: 'block | unblock | reconnect',
      required: true,
      enum: ['block', 'unblock', 'reconnect'],
    },
    { name: 'client', kind: 'positional', description: 'Client MAC, hostname, or IP', required: true },
  ],
  examples: [
    'home unifi client block aa:bb:cc:dd:ee:ff',
    'home unifi client reconnect "iPhone"',
    'home unifi client unblock 192.168.1.50',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const action = String(ctx.args.action ?? '')
    const ref = String(ctx.args.client ?? '').toLowerCase()
    if (!ref) return { ok: false, kind: 'user' as const, message: 'client is required', code: 'missing_arg' }

    // Resolve the client ref (MAC, hostname, or IP) to a MAC address
    const clients = (await listClients(cfg)) as Array<{
      mac: string; hostname?: string; name?: string; ip?: string; 'user-hostname'?: string
    }>
    const match = clients.find(
      (c) =>
        c.mac?.toLowerCase() === ref ||
        c.hostname?.toLowerCase() === ref ||
        c.name?.toLowerCase() === ref ||
        c.ip === ref ||
        c['user-hostname']?.toLowerCase() === ref,
    )

    if (!match) {
      return {
        ok: false,
        kind: 'user' as const,
        message: `no client matching "${ctx.args.client}" found`,
        code: 'not_found',
      }
    }

    const mac = match.mac
    const label = match.hostname || match.name || match.ip || mac

    let result: unknown
    if (action === 'reconnect') {
      result = await reconnectClient(cfg, mac)
    } else if (action === 'block') {
      result = await blockClient(cfg, mac)
    } else {
      result = await unblockClient(cfg, mac)
    }

    return { ok: true as const, data: { client: label, mac, action, result } }
  },
}

export const clientsAuthorizeGuest: CommandSpec = {
  path: ['clients', 'authorize-guest'],
  effect: 'destructive',
  description: 'Authorize a guest client for hotspot/guest-network access via the Integration API (write — requires --yes)',
  args: [
    { name: 'client', kind: 'positional', description: 'Client MAC, hostname, or IP', required: true },
    { name: 'minutes', kind: 'number', description: 'Time limit in minutes (optional)' },
    { name: 'yes', kind: 'boolean', description: 'Confirm authorization' },
  ],
  examples: [
    'home unifi clients authorize-guest aa:bb:cc:dd:ee:ff --minutes 60 --yes',
    'home unifi clients authorize-guest 192.168.1.50 --yes',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.client ?? '').toLowerCase().trim()
    if (!ref) return { ok: false, kind: 'user' as const, message: 'client is required', code: 'missing_arg' }

    let minutes: number | undefined
    if (ctx.args.minutes !== undefined) {
      minutes = Number(ctx.args.minutes)
      if (!Number.isInteger(minutes) || minutes < 1) {
        return { ok: false, kind: 'user' as const, message: 'minutes must be a positive integer', code: 'invalid_arg' }
      }
    }

    if (!ctx.args.yes) {
      return {
        ok: false,
        kind: 'user' as const,
        message: `refusing to authorize "${ctx.args.client}" without confirmation — re-run with --yes`,
        code: 'confirmation_required',
      }
    }

    // Resolve the client ref to its id (the integration `id` matches the private `_id`).
    const clients = (await listClients(cfg)) as Array<{
      _id: string; mac: string; hostname?: string; name?: string; ip?: string; 'user-hostname'?: string
    }>
    const match = clients.find(
      (c) =>
        c.mac?.toLowerCase() === ref ||
        c.hostname?.toLowerCase() === ref ||
        c.name?.toLowerCase() === ref ||
        c.ip === ref ||
        c['user-hostname']?.toLowerCase() === ref,
    )

    if (!match) {
      return {
        ok: false,
        kind: 'user' as const,
        message: `no client matching "${ctx.args.client}" found`,
        code: 'not_found',
      }
    }

    const label = match.hostname || match.name || match.ip || match.mac
    const result = await integrationClientAction(
      cfg,
      match._id,
      'AUTHORIZE_GUEST_ACCESS',
      minutes !== undefined ? { timeLimitMinutes: minutes } : undefined,
    )
    return { ok: true as const, data: { client: label, mac: match.mac, action: 'AUTHORIZE_GUEST_ACCESS', result } }
  },
}
