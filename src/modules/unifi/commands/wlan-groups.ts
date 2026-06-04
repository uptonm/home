import type { CommandSpec } from '../../../core/types'
import { listWlanGroups, readUnifiConfig } from '../client'

interface RawWlanGroup {
  _id: string
  name?: string
  [key: string]: unknown
}

export const wlanGroupsList: CommandSpec = {
  path: ['wlan-groups', 'list'],
  description: 'List WLAN groups referenced by wlanconf',
  args: [],
  examples: ['home unifi wlan-groups list', 'home unifi wlan-groups list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const groups = (await listWlanGroups(cfg)) as RawWlanGroup[]
    const data = groups.map((g) => ({ name: g.name ?? '' })).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const wlanGroupsGet: CommandSpec = {
  path: ['wlan-groups', 'get'],
  description: 'Dump the full wlangroup for a single group by name',
  args: [{ name: 'name', kind: 'positional', description: 'Group name (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi wlan-groups get "Default" --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const groups = (await listWlanGroups(cfg)) as RawWlanGroup[]
    const ql = ref.toLowerCase()
    const byName = groups.filter((g) => (g.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }
    const bySub = groups.filter((g) => (g.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((g) => g.name ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} groups match ${JSON.stringify(ref)}: ${names}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no wlan group matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}