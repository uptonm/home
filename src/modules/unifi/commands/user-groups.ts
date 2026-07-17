import type { CommandSpec } from '../../../core/types'
import { listUserGroups, readUnifiConfig } from '../client'

interface RawUserGroup {
  _id: string
  name?: string
  qos_rate_max_up?: number
  qos_rate_max_down?: number
  [key: string]: unknown
}

export const userGroupsList: CommandSpec = {
  path: ['user-groups', 'list'],
  effect: 'read',
  description: 'List user groups (bandwidth limits) referenced by reservations',
  args: [],
  examples: ['home unifi user-groups list', 'home unifi user-groups list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const groups = (await listUserGroups(cfg)) as RawUserGroup[]
    const data = groups
      .map((g) => ({
        name: g.name ?? '',
        down: g.qos_rate_max_down != null ? `${g.qos_rate_max_down} Kbps` : '',
        up: g.qos_rate_max_up != null ? `${g.qos_rate_max_up} Kbps` : '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const userGroupsGet: CommandSpec = {
  path: ['user-groups', 'get'],
  effect: 'read',
  description: 'Dump the full usergroup for a single group by name',
  args: [{ name: 'name', kind: 'positional', description: 'Group name (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi user-groups get "Default" --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const groups = (await listUserGroups(cfg)) as RawUserGroup[]
    const ql = ref.toLowerCase()
    const byName = groups.filter((g) => (g.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }
    const bySub = groups.filter((g) => (g.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((g) => g.name ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} groups match ${JSON.stringify(ref)}: ${names}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no user group matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}