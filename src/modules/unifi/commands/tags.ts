import type { CommandSpec } from '../../../core/types'
import { listTags, readUnifiConfig } from '../client'

interface RawTag { _id: string; name?: string; [key: string]: unknown }

export const tagsList: CommandSpec = {
  path: ['tags', 'list'],
  description: 'List device tags',
  args: [],
  examples: ['home unifi tags list', 'home unifi tags list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const tags = (await listTags(cfg)) as RawTag[]
    const data = tags.map((t) => ({ name: t.name ?? '' })).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const tagsGet: CommandSpec = {
  path: ['tags', 'get'],
  description: 'Dump a single tag by name',
  args: [{ name: 'name', kind: 'positional', description: 'Tag name (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi tags get "Server" --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const tags = (await listTags(cfg)) as RawTag[]
    const ql = ref.toLowerCase()
    const byName = tags.filter((t) => (t.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }
    const bySub = tags.filter((t) => (t.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((t) => t.name ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} tags match ${JSON.stringify(ref)}: ${names}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no tag matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}
