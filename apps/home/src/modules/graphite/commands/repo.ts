import type { CommandSpec } from '../../../core/types'
import { getTrunk, readGraphiteConfig } from '../client'

export const repoTrunk: CommandSpec = {
  path: ['repo', 'trunk'],
  effect: 'read',
  description: 'The trunk branch of the current repository, as gt reports it',
  args: [],
  examples: ['home graphite repo trunk --json'],
  async run(ctx) {
    const cfg = readGraphiteConfig(ctx.config)
    const trunk = await getTrunk(cfg)
    return { ok: true, data: { trunk } }
  },
}
