import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const chimesList: CommandSpec = {
  path: ['chimes', 'list'],
  effect: 'read',
  description: 'List Protect doorbell chimes',
  args: [],
  examples: ['home protect chimes list --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.chimes ?? [] }
  },
}

export const chimesGet: CommandSpec = {
  path: ['chimes', 'get'],
  effect: 'read',
  description: 'Get a single chime by id or name',
  args: [{ name: 'ref', kind: 'positional', description: 'Chime id or name (substring ok)', required: true }],
  examples: ['home protect chimes get <id> --json', 'home protect chimes get "Kitchen" --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.chimes ?? [], ref, 'chime')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
