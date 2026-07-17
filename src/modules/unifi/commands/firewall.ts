import type { CommandSpec } from '../../../core/types'
import { getFirewallRule, listFirewallRules, readUnifiConfig } from '../client'

interface RawFirewallRule {
  _id?: string
  name?: string
  enabled?: boolean
  action?: string
  ruleset?: string
  rule_index?: number
  protocol?: string
  src_address?: string
  dst_address?: string
  dst_port?: string
}

function shape(r: RawFirewallRule) {
  return {
    id: r._id ?? '',
    name: r.name ?? '',
    enabled: r.enabled ?? null,
    action: r.action ?? '',
    ruleset: r.ruleset ?? '',
    index: r.rule_index ?? null,
    proto: r.protocol ?? '',
    src: r.src_address ?? '',
    dst: r.dst_address ?? '',
    dstPort: r.dst_port ?? '',
  }
}

export const firewallList: CommandSpec = {
  path: ['firewall', 'list'],
  effect: 'read',
  description: 'List firewall rules',
  args: [],
  examples: [
    'home unifi firewall list',
    'home unifi firewall list --json | jq \'.[] | select(.enabled)\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const rules = (await listFirewallRules(cfg)) as RawFirewallRule[]
    const data = rules
      .map(shape)
      .sort((a, b) => {
        if (a.ruleset !== b.ruleset) return a.ruleset.localeCompare(b.ruleset)
        return (a.index ?? 0) - (b.index ?? 0)
      })
    return { ok: true, data }
  },
}

export const firewallGet: CommandSpec = {
  path: ['firewall', 'get'],
  effect: 'read',
  description: 'Fetch a single firewall rule by id',
  args: [{ name: 'id', kind: 'positional', description: 'Firewall rule _id', required: true }],
  examples: ['home unifi firewall get 5f8a1b2c3d4e5f6a7b8c9d0e --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const id = String(ctx.args.id ?? '')
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }
    const data = await getFirewallRule(cfg, id)
    if (!data) return { ok: false, kind: 'user', message: `no firewall rule with id ${id}`, code: 'not_found' }
    return { ok: true, data }
  },
}
