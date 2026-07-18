import { runProcess } from '../../../core/process'
import type { CommandSpec, RunContext, RunResult } from '../../../core/types'
import { mergeStack, restackStack, submitStack, syncStack } from '../actions'
import { getBranchInfo, listStack, readGraphiteConfig, validateBranch, type GtRunner } from '../client'
import { branchArg, confirmationRequired, optionalString, yesArg } from './shared'

export const stackList: CommandSpec = {
  path: ['stack', 'list'],
  effect: 'read',
  description:
    'Tracked branches from `gt log short` — complete raw output preserved, plus per-branch parents from bounded gt lookups (never parsed from the graph drawing)',
  args: [
    {
      name: 'all',
      kind: 'boolean',
      description: 'Show branches across all configured trunks',
    },
  ],
  examples: ['home graphite stack list --json', 'home graphite stack list --all --json'],
  async run(ctx) {
    const cfg = readGraphiteConfig(ctx.config)
    const data = await listStack(cfg, { all: ctx.args.all === true })
    return { ok: true, data }
  },
}

export const stackGet: CommandSpec = {
  path: ['stack', 'get'],
  effect: 'read',
  description:
    'One branch via `gt info`: parent, PR number/state/title, Graphite URL, tip commit — best-effort fields, full raw output preserved (bounded)',
  args: [branchArg],
  examples: ['home graphite stack get --json', 'home graphite stack get codex/github-read --json'],
  async run(ctx) {
    const cfg = readGraphiteConfig(ctx.config)
    const data = await getBranchInfo(cfg, optionalString(ctx, 'branch'))
    return { ok: true, data }
  },
}

export async function runStackRestack(ctx: RunContext, run: GtRunner = runProcess): Promise<RunResult> {
  const branch = optionalString(ctx, 'branch')
  if (ctx.args.yes !== true) {
    return confirmationRequired(branch ? `restack from ${JSON.stringify(branch)}` : 'restack the current stack')
  }
  const data = await restackStack(readGraphiteConfig(ctx.config), branch ? { branch } : {}, run)
  return { ok: true, data }
}

export const stackRestack: CommandSpec = {
  path: ['stack', 'restack'],
  effect: 'write',
  description:
    'Rebase every branch in the stack onto its parent via `gt restack --no-interactive` (write — requires --yes); a conflict halts with code graphite_conflict and gt output verbatim for you to resolve manually',
  args: [{ name: 'branch', kind: 'string', description: 'Branch to restack from (default: the current branch)' }, yesArg],
  examples: ['home graphite stack restack --yes --json', 'home graphite stack restack --branch feat/my-branch --yes --json'],
  run: (ctx) => runStackRestack(ctx),
}

export async function runStackSync(ctx: RunContext, run: GtRunner = runProcess): Promise<RunResult> {
  if (ctx.args.yes !== true) return confirmationRequired('sync branches with remote')
  const data = await syncStack(readGraphiteConfig(ctx.config), run)
  return { ok: true, data }
}

export const stackSync: CommandSpec = {
  path: ['stack', 'sync'],
  effect: 'write',
  description:
    'Pull trunk and restack open stacks via `gt sync --no-interactive` (write — requires --yes); never passes a delete flag — gt 1.8.6 has no --no-delete, so any deletions gt performs anyway (sync-cleanup config) are surfaced verbatim in deletedBranches',
  args: [yesArg],
  examples: ['home graphite stack sync --yes --json'],
  run: (ctx) => runStackSync(ctx),
}

export async function runStackSubmit(ctx: RunContext, run: GtRunner = runProcess): Promise<RunResult> {
  const dryRun = ctx.args['dry-run'] === true
  if (!dryRun && ctx.args.yes !== true) return confirmationRequired('submit the stack to GitHub')
  const data = await submitStack(readGraphiteConfig(ctx.config), { draft: ctx.args.draft === true, dryRun }, run)
  return { ok: true, data }
}

export const stackSubmit: CommandSpec = {
  path: ['stack', 'submit'],
  effect: 'write',
  description:
    'Push the stack and create/update its PRs via `gt submit --stack --no-edit --no-interactive` (write — requires --yes; --dry-run only reports and needs no --yes); pushes stay --force-with-lease — no force flag is ever passed',
  args: [
    { name: 'draft', kind: 'boolean', description: 'Create any new PRs as drafts' },
    { name: 'dry-run', kind: 'boolean', description: 'Report the PRs that would be submitted without pushing anything' },
    yesArg,
  ],
  examples: [
    'home graphite stack submit --yes --json',
    'home graphite stack submit --draft --yes --json',
    'home graphite stack submit --dry-run --json',
  ],
  run: (ctx) => runStackSubmit(ctx),
}

export async function runStackMerge(ctx: RunContext, run: GtRunner = runProcess): Promise<RunResult> {
  if (ctx.args.yes !== true) return confirmationRequired('merge the stack via Graphite')
  const data = await mergeStack(readGraphiteConfig(ctx.config), run)
  return { ok: true, data }
}

export const stackMerge: CommandSpec = {
  path: ['stack', 'merge'],
  effect: 'write',
  description:
    'Merge every PR from trunk to the current branch via `gt merge --no-interactive` (write — requires --yes); gt 1.8.6 has no partial-merge flag, so checkout the last branch to merge before running',
  args: [yesArg],
  examples: ['home graphite stack merge --yes --json'],
  run: (ctx) => runStackMerge(ctx),
}

export const stackValidate: CommandSpec = {
  path: ['stack', 'validate'],
  effect: 'read',
  description:
    'Non-mutating restack readiness: tracked by graphite, parent known, no needs-restack marker, clean working tree — structured findings, never fixes anything',
  args: [branchArg],
  examples: ['home graphite stack validate --json', 'home graphite stack validate feat/my-branch --json'],
  async run(ctx) {
    const cfg = readGraphiteConfig(ctx.config)
    const data = await validateBranch(cfg, optionalString(ctx, 'branch'))
    return { ok: true, data }
  },
}
