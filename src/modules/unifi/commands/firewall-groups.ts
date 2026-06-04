import type { CommandSpec } from '../../../core/types'
import { listFirewallGroups, readUnifiConfig } from '../client'

interface RawFirewallGroup {
  _id: string
  name?: string
  group_type?: string
  group_members?: string[]
  site_id?: string
}

export const firewallGroupsList: CommandSpec = {
  path: ['firewall-groups', 'list'],
  description: 'List firewall/IP groups referenced by firewall rules',
  args: [],
  examples: [
    'home unifi firewall-groups list',
    'home unifi firewall-groups list --json | jq \'.[] | select(.type=="address-group")\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const groups = (await listFirewallGroups(cfg)) as RawFirewallGroup[]
    const data = groups
      .map((g) => ({
        name: g.name ?? '',
        type: g.group_type ?? '',
        members: g.group_members ?? [],
      }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const firewallGroupsGet: CommandSpec = {
  path: ['firewall-groups', 'get'],
  description: 'Dump the full firewallgroup config for a single group by name',
  args: [
    {
      name: 'name',
      kind: 'positional',
      description: 'Group name (case-insensitive, exact or unique substring)',
      required: true,
    },
  ],
  examples: [
    'home unifi firewall-groups get "IoT Devices"',
    'home unifi firewall-groups get rfc1918 --json',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const groups = (await listFirewallGroups(cfg)) as RawFirewallGroup[]
    const ql = ref.toLowerCase()

    const byName = groups.filter((g) => (g.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }

    const bySub = groups.filter((g) => (g.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((g) => g.name ?? '?').join(', ')
      return {
        ok: false,
        kind: 'user',
        message: `${bySub.length} groups match ${JSON.stringify(ref)}: ${names}`,
        code: 'ambiguous',
      }
    }

    return { ok: false, kind: 'user', message: `no firewall group matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}
