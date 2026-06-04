import type { CommandSpec } from '../../../core/types'
import { listStaticRoutes, readUnifiConfig } from '../client'

interface RawRoute { _id: string; name?: string; [key: string]: unknown }

export const routesList: CommandSpec = {
  path: ['routes', 'list'],
  description: 'List static routes',
  args: [],
  examples: ['home unifi routes list', 'home unifi routes list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const routes = (await listStaticRoutes(cfg)) as RawRoute[]
    const data = routes.map((r) => ({ name: r.name ?? '' })).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const routesGet: CommandSpec = {
  path: ['routes', 'get'],
  description: 'Dump the full routing config for a single static route by name',
  args: [{ name: 'name', kind: 'positional', description: 'Route name (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi routes get "My Route" --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const routes = (await listStaticRoutes(cfg)) as RawRoute[]
    const ql = ref.toLowerCase()
    const byName = routes.filter((r) => (r.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }
    const bySub = routes.filter((r) => (r.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((r) => r.name ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} routes match ${JSON.stringify(ref)}: ${names}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no route matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}
