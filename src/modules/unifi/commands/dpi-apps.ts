import type { CommandSpec } from '../../../core/types'
import { listDpiApps, readUnifiConfig } from '../client'

interface RawDpiApp { _id: string; name?: string; [key: string]: unknown }

export const dpiAppsList: CommandSpec = {
  path: ['dpi-apps', 'list'],
  effect: 'read',
  description: 'List DPI application signatures',
  args: [],
  examples: ['home unifi dpi-apps list', 'home unifi dpi-apps list --json | jq \'.[] | select(.name|test(\"spotify\";\"i\"))\''],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const apps = (await listDpiApps(cfg)) as RawDpiApp[]
    const data = apps.map((a) => ({ name: a.name ?? '' })).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const dpiAppsGet: CommandSpec = {
  path: ['dpi-apps', 'get'],
  effect: 'read',
  description: 'Dump a single DPI app by name',
  args: [{ name: 'name', kind: 'positional', description: 'App name (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi dpi-apps get spotify --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const apps = (await listDpiApps(cfg)) as RawDpiApp[]
    const ql = ref.toLowerCase()
    const byName = apps.filter((a) => (a.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }
    const bySub = apps.filter((a) => (a.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((a) => a.name ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} apps match ${JSON.stringify(ref)}: ${names}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no DPI app matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}
