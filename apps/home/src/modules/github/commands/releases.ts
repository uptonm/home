import type { CommandSpec } from '../../../core/types'
import { listReleases, readGithubConfig } from '../client'
import { limitArg, optionalString, parseLimit, repoArg } from './shared'

export const releasesList: CommandSpec = {
  path: ['releases', 'list'],
  effect: 'read',
  description: 'Recent releases: tag, name, publish date, prerelease/draft flags, and URL',
  args: [repoArg, limitArg],
  examples: [
    'home github releases list --json',
    'home github releases list --repo cli/cli --limit 5 --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await listReleases(cfg, {
      repo: optionalString(ctx, 'repo'),
      limit: parseLimit(ctx),
    })
    return { ok: true, data }
  },
}
