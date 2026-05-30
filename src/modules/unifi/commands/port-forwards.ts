import type { CommandSpec } from '../../../core/types'
import { listPortForwards, readUnifiConfig } from '../client'

interface RawPortForward {
  name?: string
  enabled?: boolean
  proto?: string
  pfwd_interface?: string
  dst_port?: string
  fwd?: string
  fwd_port?: string
  destination_ip?: string
}

export const portForwardsList: CommandSpec = {
  path: ['port-forwards', 'list'],
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
