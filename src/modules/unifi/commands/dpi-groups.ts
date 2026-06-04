import type { CommandSpec } from '../../../core/types'
import { listDpiGroups, readUnifiConfig } from '../client'

interface RawDpiGroup { _id: string; name?: string; [key: string]: unknown }

export const dpiGroupsList: CommandSpec = {
  path: ['dpi-groups', 'list'],
  description: 'List DPI group configurations',
  args: [],
  examples: ['home unifi dpi-groups list', 'home unifi dpi-groups list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const groups = (await listDpiGroups(cfg)) as RawDpiGroup[]
    const data = groups.map((g) => ({ name: g.name ?? '' })).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const dpiGroupsGet: CommandSpec = {
  path: ['dpi-groups', 'get'],
  description: 'Dump a single DPI group by name',
  args: [{ name: 'name', kind: 'positional', description: 'Group name (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi dpi-groups get "Default" --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const groups = (await listDpiGroups(cfg)) as RawDpiGroup[]
    const ql = ref.toLowerCase()
    const byName = groups.filter((g) => (g.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }
    const bySub = groups.filter((g) => (g.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((g) => g.name ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} groups match ${JSON.stringify(ref)}: ${names}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no DPI group matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}
