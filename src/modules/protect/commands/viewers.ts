import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const viewersList: CommandSpec = {
  path: ['viewers', 'list'],
  description: 'List Protect Viewport displays',
  args: [],
  examples: ['home protect viewers list --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.viewers ?? [] }
  },
}

export const viewersGet: CommandSpec = {
  path: ['viewers', 'get'],
  description: 'Get a single viewer by id or name',
  args: [{ name: 'ref', kind: 'positional', description: 'Viewer id or name (substring ok)', required: true }],
  examples: ['home protect viewers get <id> --json', 'home protect viewers get "Office" --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.viewers ?? [], ref, 'viewer')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
