import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'
import { pickOne } from './shared'

export const sensorsList: CommandSpec = {
  path: ['sensors', 'list'],
  description: 'List Protect sensors (door/window/motion/leak, temp/humidity/light)',
  args: [],
  examples: [
    'home protect sensors list --json',
    'home protect sensors list --json | jq \'.[] | {id, name, type, batteryStatus}\'',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.sensors ?? [] }
  },
}

export const sensorsGet: CommandSpec = {
  path: ['sensors', 'get'],
  description: 'Get a single sensor by id or name',
  args: [{ name: 'ref', kind: 'positional', description: 'Sensor id or name (substring ok)', required: true }],
  examples: ['home protect sensors get <id> --json', 'home protect sensors get "Front Door" --json'],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const ref = String(ctx.args.ref ?? '')
    if (!ref) return { ok: false, kind: 'user', message: 'ref is required', code: 'missing_arg' }
    const bootstrap = await getBootstrap(cfg)
    const picked = pickOne(bootstrap.sensors ?? [], ref, 'sensor')
    if (!picked.ok) return picked.error
    return { ok: true, data: picked.item }
  },
}
