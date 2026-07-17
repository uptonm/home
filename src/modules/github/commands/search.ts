import type { CommandSpec } from '../../../core/types'
import { readGithubConfig, searchCode as searchCodeQuery } from '../client'
import { limitArg, optionalString, parseLimit, requiredRef } from './shared'

export const searchCode: CommandSpec = {
  path: ['search', 'code'],
  effect: 'read',
  description: 'Search code across GitHub: repo, path, URL, and bounded matching text fragments per hit',
  args: [
    {
      name: 'query',
      kind: 'positional',
      description: 'Code search query, gh syntax (e.g. "myFunction language:typescript")',
      required: true,
    },
    { name: 'owner', kind: 'string', description: 'Restrict to a user or organization' },
    {
      name: 'repo',
      kind: 'string',
      description: 'Restrict to one repository (owner/name; search is global by default — no defaultRepo fallback)',
    },
    limitArg,
  ],
  examples: [
    'home github search code "readGithubConfig" --repo uptonm/home --json',
    'home github search code "boundText language:typescript" --owner uptonm --json',
    'home github search code "NewCmdRoot" --repo cli/cli --limit 5 --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await searchCodeQuery(cfg, requiredRef(ctx, 'query'), {
      owner: optionalString(ctx, 'owner'),
      repo: optionalString(ctx, 'repo'),
      limit: parseLimit(ctx),
    })
    return { ok: true, data }
  },
}
