import type { CommandSpec } from '../../../core/types'
import { getPortForward, listPortForwards, readUnifiConfig } from '../client'

interface RawPortForward {
  name?: string
  enabled?: boolean
  proto?: string
  pfwd_interface?: string
  dst_port?: string
  fwd?: string
  fwd_port?: string
  destination_ip?: string
  _id?: string
}

export const portForwardsList: CommandSpec = {
  path: ['port-forwards', 'list'],
  effect: 'read',
  description: 'List WAN port-forward (NAT) rules',
  args: [],
  examples: [
    'home unifi port-forwards list',
    'home unifi port-forwards list --json | jq \'.[] | select(.enabled)\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const rules = (await listPortForwards(cfg)) as RawPortForward[]
    const data = rules
      .map((r) => ({
        name: r.name ?? '',
        enabled: r.enabled ?? null,
        proto: r.proto ?? '',
        wan: r.pfwd_interface ?? '',
        port: r.dst_port ?? '',
        forward: r.fwd ? `${r.fwd}:${r.fwd_port ?? r.dst_port ?? ''}` : '',
        from: r.destination_ip ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const portForwardsGet: CommandSpec = {
  path: ['port-forwards', 'get'],
  effect: 'read',
  description: 'Dump the full portforward config for a single rule by name or _id',
  args: [
    {
      name: 'name',
      kind: 'positional',
      description: 'Rule name (case-insensitive, substring ok) or _id',
      required: true,
    },
  ],
  examples: [
    'home unifi port-forwards get "Plex"',
    'home unifi port-forwards get 61abc123def456 --json',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const result = await getPortForward(cfg, ref)
    if (result.kind === 'not_found') {
      return { ok: false, kind: 'user', message: `no port forward matching ${JSON.stringify(ref)}`, code: 'not_found' }
    }
    if (result.kind === 'ambiguous') {
      const names = result.matches.map((r) => r.name ?? r._id ?? '?').join(', ')
      return {
        ok: false,
        kind: 'user',
        message: `${result.matches.length} rules match ${JSON.stringify(ref)}: ${names}`,
        code: 'ambiguous',
      }
    }
    return { ok: true, data: result.rule }
  },
}
