import type { CommandSpec } from '../../../core/types'
import { getPr, getPrChecks, getPrDiff, listPrs, readGithubConfig } from '../client'
import { limitArg, optionalString, parseLimit, repoArg, requiredRef } from './shared'

const PR_STATES = ['open', 'closed', 'merged', 'all'] as const

export const prsList: CommandSpec = {
  path: ['prs', 'list'],
  effect: 'read',
  description: 'List pull requests with author, head/base refs, and draft state',
  args: [
    repoArg,
    { name: 'state', kind: 'string', description: 'open | closed | merged | all (default open)', enum: PR_STATES },
    { name: 'author', kind: 'string', description: 'Filter by author login' },
    limitArg,
  ],
  examples: [
    'home github prs list --json',
    'home github prs list --repo cli/cli --state merged --limit 10 --json',
    'home github prs list --author uptonm --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await listPrs(cfg, {
      repo: optionalString(ctx, 'repo'),
      state: optionalString(ctx, 'state'),
      author: optionalString(ctx, 'author'),
      limit: parseLimit(ctx),
    })
    return { ok: true, data }
  },
}

export const prsGet: CommandSpec = {
  path: ['prs', 'get'],
  effect: 'read',
  description: 'One PR in detail: reviews, mergeability, head/base refs, labels, and stack links found in the body',
  args: [
    { name: 'ref', kind: 'positional', description: 'PR number (42, #42) or full URL', required: true },
    repoArg,
  ],
  examples: [
    'home github prs get 42 --json',
    'home github prs get https://github.com/cli/cli/pull/1234 --json',
    'home github prs get 42 --repo uptonm/home --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await getPr(cfg, requiredRef(ctx, 'ref'), optionalString(ctx, 'repo'))
    return { ok: true, data }
  },
}

export const prsChecks: CommandSpec = {
  path: ['prs', 'checks'],
  effect: 'read',
  description: 'CI check runs for a PR, summarized: pass/fail/pending/skipped counts plus the failing check names',
  args: [
    { name: 'ref', kind: 'positional', description: 'PR number (42, #42) or full URL', required: true },
    repoArg,
  ],
  examples: [
    'home github prs checks 42 --json',
    'home github prs checks 42 --repo uptonm/home --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await getPrChecks(cfg, requiredRef(ctx, 'ref'), optionalString(ctx, 'repo'))
    return { ok: true, data }
  },
}

export const prsDiff: CommandSpec = {
  path: ['prs', 'diff'],
  effect: 'read',
  description: 'PR diff as a size-capped patch (truncation flagged), or just the changed file names with --name-only',
  args: [
    { name: 'ref', kind: 'positional', description: 'PR number (42, #42) or full URL', required: true },
    repoArg,
    { name: 'name-only', kind: 'boolean', description: 'List changed file paths instead of the patch' },
  ],
  examples: [
    'home github prs diff 42 --name-only --json',
    'home github prs diff 42 --repo uptonm/home --json',
  ],
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await getPrDiff(cfg, requiredRef(ctx, 'ref'), {
      repo: optionalString(ctx, 'repo'),
      nameOnly: Boolean(ctx.args['name-only']),
    })
    return { ok: true, data }
  },
}
