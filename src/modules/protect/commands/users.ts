import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const usersList: CommandSpec = {
  path: ['users', 'list'],
  effect: 'read',
  description: 'List Protect users and their permissions',
  args: [],
  examples: [
    'home protect users list --json',
    'home protect users list --json | jq \'.[] | {id, name: .localUsername, role: .allPermissions}\'',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.users ?? [] }
  },
}

export const usersGet: CommandSpec = {
  path: ['users', 'get'],
  effect: 'read',
  description: 'Get a single user by id or name',
  args: [{ name: 'ref', kind: 'positional', description: 'User id or name (substring ok)', required: true }],
  examples: ['home protect users get <id> --json', 'home protect users get admin --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.users ?? [], ref, 'user')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
