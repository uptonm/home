import type { CommandSpec } from '../../../core/types'
import { getRepo, readGithubConfig } from '../client'
import { optionalString } from './shared'

export const reposGet: CommandSpec = {
  path: ['repos', 'get'],
  effect: 'read',
  description: 'Repository identity: default branch, visibility, description, fork/archive flags',
  args: [
    {
      name: 'repo',
      kind: 'positional',
      description: 'Repository as owner/name (default: configured defaultRepo, else inferred from the cwd checkout)',
    },
  ],
  examples: [
    'home github repos get uptonm/home --json',
    'home github repos get --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await getRepo(cfg, optionalString(ctx, 'repo'))
    return { ok: true, data }
  },
}
