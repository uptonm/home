import { runProcess } from '../../../core/process'
import type { CommandSpec, RunContext, RunResult } from '../../../core/types'
import { createBranch, trackBranch } from '../actions'
import { getChildren, getParent, readGraphiteConfig, type GtRunner } from '../client'
import { branchArg, confirmationRequired, optionalString, yesArg } from './shared'

export const branchParent: CommandSpec = {
  path: ['branch', 'parent'],
  effect: 'read',
  description:
    'Parent of the current branch (`gt parent`) or a named branch (via gt info); trunk reports parent null with isTrunk true',
  args: [branchArg],
  examples: ['home graphite branch parent --json', 'home graphite branch parent codex/github-read --json'],
  async run(ctx) {
    const cfg = readGraphiteConfig(ctx.config)
    const data = await getParent(cfg, optionalString(ctx, 'branch'))
    return { ok: true, data }
  },
}

export async function runBranchCreate(ctx: RunContext, run: GtRunner = runProcess): Promise<RunResult> {
  const name = optionalString(ctx, 'name')
  const message = optionalString(ctx, 'message')
  if (!name) return { ok: false, kind: 'user', message: 'a branch name is required', code: 'missing_arg' }
  if (!message) return { ok: false, kind: 'user', message: 'a commit message is required (--message)', code: 'missing_arg' }
  if (ctx.args.yes !== true) return confirmationRequired(`create branch ${JSON.stringify(name)} from staged changes`)
  const data = await createBranch(readGraphiteConfig(ctx.config), name, message, run)
  return { ok: true, data }
}

export const branchCreate: CommandSpec = {
  path: ['branch', 'create'],
  effect: 'write',
  description:
    'Stack a new branch on the current one via `gt create <name> -m <msg> --no-interactive` (write — requires --yes); commits only already-staged changes — it never stages anything, and an empty index yields an empty branch',
  args: [
    { name: 'name', kind: 'positional', required: true, description: 'Name for the new branch' },
    { name: 'message', kind: 'string', required: true, description: 'Commit message for the staged changes' },
    yesArg,
  ],
  examples: ['home graphite branch create feat/my-change --message "feat: my change" --yes --json'],
  run: (ctx) => runBranchCreate(ctx),
}

export async function runBranchTrack(ctx: RunContext, run: GtRunner = runProcess): Promise<RunResult> {
  const branch = optionalString(ctx, 'branch')
  const parent = optionalString(ctx, 'parent')
  if (!branch) return { ok: false, kind: 'user', message: 'a branch name is required', code: 'missing_arg' }
  if (!parent) return { ok: false, kind: 'user', message: 'a parent branch is required (--parent)', code: 'missing_arg' }
  if (ctx.args.yes !== true) return confirmationRequired(`track ${JSON.stringify(branch)} under ${JSON.stringify(parent)}`)
  const data = await trackBranch(readGraphiteConfig(ctx.config), branch, parent, run)
  return { ok: true, data }
}

export const branchTrack: CommandSpec = {
  path: ['branch', 'track'],
  effect: 'write',
  description:
    'Start tracking an existing branch with Graphite via `gt track <branch> --parent <parent> --no-interactive` (write — requires --yes); the parent must already be tracked',
  args: [
    { name: 'branch', kind: 'positional', required: true, description: 'Branch to start tracking' },
    { name: 'parent', kind: 'string', required: true, description: 'Tracked branch to record as its parent' },
    yesArg,
  ],
  examples: ['home graphite branch track feat/my-change --parent main --yes --json'],
  run: (ctx) => runBranchTrack(ctx),
}

export const branchChildren: CommandSpec = {
  path: ['branch', 'children'],
  effect: 'read',
  description:
    'Children of the current branch (`gt children`), or of a named branch derived from bounded per-branch parent lookups',
  args: [branchArg],
  examples: ['home graphite branch children --json', 'home graphite branch children main --json'],
  async run(ctx) {
    const cfg = readGraphiteConfig(ctx.config)
    const data = await getChildren(cfg, optionalString(ctx, 'branch'))
    return { ok: true, data }
  },
}
