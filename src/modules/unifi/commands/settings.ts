import type { CommandSpec } from '../../../core/types'
import { listSettings, readUnifiConfig } from '../client'

interface RawSetting { key?: string; [key: string]: unknown }

export const settingsList: CommandSpec = {
  path: ['settings', 'list'],
  description: 'List all UniFi site settings (sections with keys)',
  args: [],
  examples: ['home unifi settings list', 'home unifi settings list --json | jq \'.[] | .key\''],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const sections = (await listSettings(cfg)) as RawSetting[]
    const data = sections.map((s) => ({ key: s.key ?? '' })).sort((a, b) => a.key.localeCompare(b.key))
    return { ok: true, data }
  },
}

export const settingsGet: CommandSpec = {
  path: ['settings', 'get'],
  description: 'Dump a single settings section by key (e.g. "usg", "mgmt", "super_mgmt")',
  args: [{ name: 'key', kind: 'positional', description: 'Settings key (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi settings get usg --json', 'home unifi settings get mgmt'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.key ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'key is required', code: 'missing_arg' }
    const sections = (await listSettings(cfg)) as RawSetting[]
    const ql = ref.toLowerCase()
    const byKey = sections.filter((s) => (s.key ?? '').toLowerCase() === ql)
    if (byKey.length === 1) return { ok: true, data: byKey[0] }
    const bySub = sections.filter((s) => (s.key ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const keys = bySub.map((s) => s.key ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} settings match ${JSON.stringify(ref)}: ${keys}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no setting matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}
