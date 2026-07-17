import type { CommandSpec } from '../../../core/types'
import { listRadiusAccounts, readUnifiConfig } from '../client'

interface RawAccount { _id: string; name?: string; [key: string]: unknown }

export const radiusAccountsList: CommandSpec = {
  path: ['radius-accounts', 'list'],
  effect: 'read',
  description: 'List RADIUS user accounts',
  args: [],
  examples: ['home unifi radius-accounts list', 'home unifi radius-accounts list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const accounts = (await listRadiusAccounts(cfg)) as RawAccount[]
    const data = accounts.map((a) => ({ name: a.name ?? '' })).sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, data }
  },
}

export const radiusAccountsGet: CommandSpec = {
  path: ['radius-accounts', 'get'],
  effect: 'read',
  description: 'Dump a single RADIUS account by name',
  args: [{ name: 'name', kind: 'positional', description: 'Account name (case-insensitive, exact or unique substring)', required: true }],
  examples: ['home unifi radius-accounts get user1 --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ref = String(ctx.args.name ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'name is required', code: 'missing_arg' }
    const accounts = (await listRadiusAccounts(cfg)) as RawAccount[]
    const ql = ref.toLowerCase()
    const byName = accounts.filter((a) => (a.name ?? '').toLowerCase() === ql)
    if (byName.length === 1) return { ok: true, data: byName[0] }
    const bySub = accounts.filter((a) => (a.name ?? '').toLowerCase().includes(ql))
    if (bySub.length === 1) return { ok: true, data: bySub[0] }
    if (bySub.length > 1) {
      const names = bySub.map((a) => a.name ?? '?').join(', ')
      return { ok: false, kind: 'user', message: `${bySub.length} accounts match ${JSON.stringify(ref)}: ${names}`, code: 'ambiguous' }
    }
    return { ok: false, kind: 'user', message: `no RADIUS account matching ${JSON.stringify(ref)}`, code: 'not_found' }
  },
}
