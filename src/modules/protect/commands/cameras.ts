import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const camerasList: CommandSpec = {
  path: ['cameras', 'list'],
  effect: 'read',
  description: 'List Protect cameras',
  args: [],
  examples: [
    'home protect cameras list --json',
    'home protect cameras list --json | jq \'.[] | {id, name, state}\'',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.cameras ?? [] }
  },
}

export const camerasGet: CommandSpec = {
  path: ['cameras', 'get'],
  effect: 'read',
  description: 'Get a single camera by id or name',
  args: [{ name: 'id', kind: 'positional', description: 'Camera id or name (substring ok)', required: true }],
  examples: ['home protect cameras get <id> --json', 'home protect cameras get "Front Door" --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.id ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.cameras ?? [], ref, 'camera')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
