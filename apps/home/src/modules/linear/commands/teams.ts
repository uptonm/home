import type { CommandSpec } from '../../../core/types'
import { listTeams } from '../client'
import { getLinearConfig, withWarnings } from './shared'

export const teamsList: CommandSpec = {
  path: ['teams', 'list'],
  effect: 'read',
  description: 'List teams in the workspace — id, key, and name.',
  args: [],
  examples: ['home linear teams list --json'],
  async run(ctx) {
    const cfg = getLinearConfig(ctx)
    const page = await listTeams(cfg)
    return { ok: true, data: withWarnings({ teams: page.nodes }, page.warnings) }
  },
}
