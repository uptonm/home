import type { CommandSpec } from '../../../core/types'
import { blockClient, listClients, readUnifiConfig, reconnectClient, unblockClient } from '../client'

export const clientsControl: CommandSpec = {
  path: ['client'],
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
