import type { CommandSpec } from '../../../core/types'
import { getBranchInfo, listStack, readGraphiteConfig, validateBranch } from '../client'
import { branchArg, optionalString } from './shared'

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
