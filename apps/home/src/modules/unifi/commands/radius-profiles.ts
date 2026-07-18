import type { CommandSpec } from '../../../core/types'
import { listRadiusProfiles, readUnifiConfig } from '../client'

interface RawRadiusProfile {
  _id: string
  name?: string
  [key: string]: unknown
}

export const radiusProfilesList: CommandSpec = {
  path: ['radius-profiles', 'list'],
  effect: 'read',
  description: 'List RADIUS profiles referenced by WLANs and networks',
  args: [],
  examples: ['home unifi radius-profiles list', 'home unifi radius-profiles list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const profiles = (await listRadiusProfiles(cfg)) as RawRadiusProfile[]
    const data = profiles.map((p) => ({ name: p.name ?? '' })).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const radiusProfilesGet: CommandSpec = {
  path: ['radius-profiles', 'get'],
  effect: 'read',
  description: 'Dump the full radiusprofile for a single profile by name',
  args: [{ name: 'name', kind: 'positional', description: 'Profile name (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi radius-profiles get "Default" --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const profiles = (await listRadiusProfiles(cfg)) as RawRadiusProfile[]
    const ql = ref.toLowerCase()
    const byName = profiles.filter((p) => (p.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }
    const bySub = profiles.filter((p) => (p.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((p) => p.name ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} profiles match ${JSON.stringify(ref)}: ${names}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no RADIUS profile matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}