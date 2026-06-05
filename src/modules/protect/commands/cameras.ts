import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'

export const camerasList: CommandSpec = {
  path: ['cameras', 'list'],
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
  description: 'Get a single camera by id',
  args: [{ name: 'id', kind: 'positional', description: 'Camera id', required: true }],
  examples: ['home protect cameras get <id> --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.id ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const camera = (bootstrap.cameras ?? []).find((c) => c.id === ref) ?? null
    if (!camera) return { ok: false, kind: 'user', message: `no camera with id ${ref}`, code: 'not_found' }
    return { ok: true, data: camera }
  },
}
