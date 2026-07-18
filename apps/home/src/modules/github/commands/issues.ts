import type { CommandSpec } from '../../../core/types'
import { getIssue, listIssues, readGithubConfig } from '../client'
import { limitArg, optionalString, parseLimit, repoArg, requiredRef } from './shared'

const ISSUE_STATES = ['open', 'closed', 'all'] as const

export const issuesList: CommandSpec = {
  path: ['issues', 'list'],
  effect: 'read',
  description: 'List issues with author, labels, and assignees',
  args: [
    repoArg,
    { name: 'state', kind: 'string', description: 'open | closed | all (default open)', enum: ISSUE_STATES },
    { name: 'label', kind: 'string', description: 'Filter by label name' },
    limitArg,
  ],
  examples: [
    'home github issues list --json',
    'home github issues list --repo cli/cli --label bug --state open --limit 10 --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await listIssues(cfg, {
      repo: optionalString(ctx, 'repo'),
      state: optionalString(ctx, 'state'),
      label: optionalString(ctx, 'label'),
      limit: parseLimit(ctx),
    })
    return { ok: true, data }
  },
}

export const issuesGet: CommandSpec = {
  path: ['issues', 'get'],
  effect: 'read',
  description: 'One issue in detail with its newest comments (bounded; truncation flagged)',
  args: [
    { name: 'ref', kind: 'positional', description: 'Issue number (42, #42) or full URL', required: true },
    repoArg,
  ],
  examples: [
    'home github issues get 42 --json',
    'home github issues get https://github.com/cli/cli/issues/1234 --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await getIssue(cfg, requiredRef(ctx, 'ref'), optionalString(ctx, 'repo'))
    return { ok: true, data }
  },
}
