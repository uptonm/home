import type { CommandSpec } from '../../../core/types'
import { getRun, listRuns, readGithubConfig } from '../client'
import { limitArg, optionalString, parseLimit, repoArg, requiredRef } from './shared'

export const runsList: CommandSpec = {
  path: ['runs', 'list'],
  effect: 'read',
  description: 'List GitHub Actions workflow runs with status, conclusion, and branch',
  args: [
    repoArg,
    { name: 'branch', kind: 'string', description: 'Filter by head branch' },
    {
      name: 'status',
      kind: 'string',
      description: 'Filter by status/conclusion (e.g. queued, in_progress, completed, success, failure, cancelled)',
    },
    limitArg,
  ],
  examples: [
    'home github runs list --json',
    'home github runs list --repo uptonm/home --branch main --status failure --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await listRuns(cfg, {
      repo: optionalString(ctx, 'repo'),
      branch: optionalString(ctx, 'branch'),
      status: optionalString(ctx, 'status'),
      limit: parseLimit(ctx),
    })
    return { ok: true, data }
  },
}

export const runsGet: CommandSpec = {
  path: ['runs', 'get'],
  effect: 'read',
  description: 'One workflow run in detail: jobs with per-job conclusion and timing, overall duration, URL',
  args: [
    { name: 'id', kind: 'positional', description: 'Run id (databaseId from `runs list`)', required: true },
    repoArg,
  ],
  examples: [
    'home github runs get 29551783681 --repo cli/cli --json',
    'home github runs get 29551783681 --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await getRun(cfg, requiredRef(ctx, 'id'), optionalString(ctx, 'repo'))
    return { ok: true, data }
  },
}
