import type { CommandSpec } from '../../../core/types'
import { getSummary, readGithubConfig } from '../client'
import { optionalString, repoArg } from './shared'

export const summary: CommandSpec = {
  path: ['summary'],
  effect: 'read',
  description:
    'One briefing: my open PRs with CI check rollups (failing checks named), PRs awaiting my review, and recent failed workflow runs — each item carries the pr number / run id / repo for follow-up commands',
  args: [repoArg],
  examples: [
    'home github summary --json',
    'home github summary --repo uptonm/home --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await getSummary(cfg, optionalString(ctx, 'repo'))
    return { ok: true, data }
  },
}
