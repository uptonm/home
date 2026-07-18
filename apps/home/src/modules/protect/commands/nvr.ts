import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'

export const nvrInfo: CommandSpec = {
  path: ['nvr', 'info'],
  effect: 'read',
  description: 'Show the NVR (Protect controller) configuration and status',
  args: [],
  examples: [
    'home protect nvr info --json',
    'home protect nvr info --json | jq \'{name, version, uptime, storageInfo}\'',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    const nvr = bootstrap.nvr
    if (!nvr) return { ok: false, kind: 'system', message: 'no nvr in bootstrap', code: 'empty' }
    return { ok: true, data: nvr }
  },
}
