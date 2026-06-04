import type { CommandSpec } from '../../../core/types'
import { getNetwork, listNetworks, readUnifiConfig } from '../client'

interface RawNetwork {
  name?: string
  purpose?: string
  vlan?: number
  ip_subnet?: string
  dhcpd_enabled?: boolean
  dhcpd_start?: string
  dhcpd_stop?: string
  enabled?: boolean
}

function purposeRank(purpose: string | undefined): number {
  if (purpose === 'corporate' || purpose === 'guest') return 0
  if (purpose === 'wan') return 1
  return 2 // vpn / remote-user-vpn / site-vpn / anything else
}

export const networksList: CommandSpec = {
  path: ['networks', 'list'],
  description: 'List configured networks/VLANs with subnet and DHCP range',
  args: [],
  examples: [
    'home unifi networks list',
    'home unifi networks list --json | jq \'.[] | select(.vlan)\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const networks = (await listNetworks(cfg)) as RawNetwork[]
    const data = networks
      .map((n) => ({
        name: n.name ?? '',
        purpose: n.purpose ?? '',
        vlan: n.vlan ?? null,
        subnet: n.ip_subnet ?? '',
        dhcp: n.dhcpd_enabled ? `${n.dhcpd_start}-${n.dhcpd_stop}` : n.ip_subnet ? 'off' : '',
        enabled: n.enabled ?? null,
      }))
      .sort(
        (a, b) =>
          purposeRank(a.purpose) - purposeRank(b.purpose) ||
          (a.vlan ?? 0) - (b.vlan ?? 0) ||
          a.name.localeCompare(b.name),
      )
    return { ok: true, data }
  },
}

export const networksGet: CommandSpec = {
  path: ['networks', 'get'],
  description: 'Dump the full networkconf for a single network by name, VLAN id, or _id',
  args: [
    {
      name: 'name',
      kind: 'positional',
      description: 'Network name (case-insensitive, substring ok), VLAN id, or _id',
      required: true,
    },
  ],
  examples: [
    'home unifi networks get IoT',
    'home unifi networks get 180',
    'home unifi networks get "Default" --json',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const result = await getNetwork(cfg, ref)
    if (result.kind === 'not_found') {
      return { ok: false, kind: 'user', message: `no network matching ${JSON.stringify(ref)}`, code: 'not_found' }
    }
    if (result.kind === 'ambiguous') {
      const names = result.matches.map((n) => n.name ?? n._id ?? '?').join(', ')
      return {
        ok: false,
        kind: 'user',
        message: `${result.matches.length} networks match ${JSON.stringify(ref)}: ${names}`,
        code: 'ambiguous',
      }
    }
    return { ok: true, data: result.network }
  },
}
