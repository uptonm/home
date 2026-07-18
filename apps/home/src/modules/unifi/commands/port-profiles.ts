import type { CommandSpec } from '../../../core/types'
import { listPortProfiles, readUnifiConfig } from '../client'

interface RawPortProfile {
  _id: string
  name?: string
  poe_mode?: string
  [key: string]: unknown
}

export const portProfilesList: CommandSpec = {
  path: ['port-profiles', 'list'],
  effect: 'read',
  description: 'List switch port profiles (portconf) referenced by switch port_table',
  args: [],
  examples: [
    'home unifi port-profiles list',
    'home unifi port-profiles list --json | jq \'.[] | select(.poe_mode=="auto")\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const profiles = (await listPortProfiles(cfg)) as RawPortProfile[]
    const data = profiles
      .map((p) => ({
        name: p.name ?? '',
        poe: p.poe_mode ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const portProfilesGet: CommandSpec = {
  path: ['port-profiles', 'get'],
  effect: 'read',
  description: 'Dump the full portconf for a single port profile by name',
  args: [{ name: 'name', kind: 'positional', description: 'Profile name (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi port-profiles get "All"', 'home unifi port-profiles get PoE --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const profiles = (await listPortProfiles(cfg)) as RawPortProfile[]
    const ql = ref.toLowerCase()
    const byName = profiles.filter((p) => (p.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }
    const bySub = profiles.filter((p) => (p.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((p) => p.name ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} profiles match ${JSON.stringify(ref)}: ${names}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no port profile matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}