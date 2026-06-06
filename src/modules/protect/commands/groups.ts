import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const groupsList: CommandSpec = {
  path: ['groups', 'list'],
  description: 'List Protect permission groups',
  args: [],
  examples: ['home protect groups list --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.groups ?? [] }
  },
}

export const groupsGet: CommandSpec = {
  path: ['groups', 'get'],
  description: 'Get a single group by id or name',
  args: [{ name: 'ref', kind: 'positional', description: 'Group id or name (substring ok)', required: true }],
  examples: ['home protect groups get <id> --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.groups ?? [], ref, 'group')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
