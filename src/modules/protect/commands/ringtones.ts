import type { CommandSpec } from '../../../core/types'
import { getBootstrap, readProtectConfig } from '../client'

export const ringtonesList: CommandSpec = {
  path: ['ringtones', 'list'],
  description: 'List the chime ringtone library',
  args: [],
  examples: [
    'home protect ringtones list --json',
    'home protect ringtones list --json | jq \'.[] | {id, name}\'',
  ],
  async run(ctx) {
    const cfg = readProtectConfig(ctx.config)
    const bootstrap = await getBootstrap(cfg)
    return { ok: true, data: bootstrap.ringtones ?? [] }
  },
}
