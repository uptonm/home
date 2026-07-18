import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const doorlocksList: CommandSpec = {
  path: ['doorlocks', 'list'],
  effect: 'read',
  description: 'List Protect smart locks (lock state, battery)',
  args: [],
  examples: [
    'home protect doorlocks list --json',
    'home protect doorlocks list --json | jq \'.[] | {id, name, lockState, batteryStatus}\'',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.doorlocks ?? [] }
  },
}

export const doorlocksGet: CommandSpec = {
  path: ['doorlocks', 'get'],
  effect: 'read',
  description: 'Get a single smart lock by id or name',
  args: [{ name: 'ref', kind: 'positional', description: 'Doorlock id or name (substring ok)', required: true }],
  examples: ['home protect doorlocks get <id> --json', 'home protect doorlocks get "Front" --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.doorlocks ?? [], ref, 'doorlock')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
