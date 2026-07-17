import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const liveviewsList: CommandSpec = {
  path: ['liveviews', 'list'],
  effect: 'read',
  description: 'List saved multi-camera liveview layouts',
  args: [],
  examples: ['home protect liveviews list --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.liveviews ?? [] }
  },
}

export const liveviewsGet: CommandSpec = {
  path: ['liveviews', 'get'],
  effect: 'read',
  description: 'Get a single liveview by id or name',
  args: [{ name: 'ref', kind: 'positional', description: 'Liveview id or name (substring ok)', required: true }],
  examples: ['home protect liveviews get <id> --json', 'home protect liveviews get "All Cameras" --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.liveviews ?? [], ref, 'liveview')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
