import type { CommandSpec } from '../../../core/types'
import { readProtectConfig, withApi } from '../client'

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
    const cameras = await withApi(cfg, async (api) => api.bootstrap?.cameras ?? [])
    return { ok: true, data: cameras }
  },
}

export const camerasGet: CommandSpec = {
  path: ['cameras', 'get'],
  description: 'Get a single camera by id',
  args: [{ name: 'id', kind: 'positional', description: 'Camera id', required: true }],
  examples: ['home protect cameras get <id> --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const id = String(ctx.args.id ?? '')
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }
    const camera = await withApi(cfg, async (api) => api.bootstrap?.cameras?.find((c) => c.id === id) ?? null)
    if (!camera) return { ok: false, kind: 'user', message: `no camera with id ${id}`, code: 'not_found' }
    return { ok: true, data: camera }
  },
}
