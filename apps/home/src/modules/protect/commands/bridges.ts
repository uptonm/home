import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const bridgesList: CommandSpec = {
  path: ['bridges', 'list'],
  effect: 'read',
  description: 'List UP Connect bridges',
  args: [],
  examples: ['home protect bridges list --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.bridges ?? [] }
  },
}

export const bridgesGet: CommandSpec = {
  path: ['bridges', 'get'],
  effect: 'read',
  description: 'Get a single bridge by id or name',
  args: [{ name: 'ref', kind: 'positional', description: 'Bridge id or name (substring ok)', required: true }],
  examples: ['home protect bridges get <id> --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.bridges ?? [], ref, 'bridge')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
