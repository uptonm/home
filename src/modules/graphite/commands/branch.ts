import type { CommandSpec } from '../../../core/types'
import { getChildren, getParent, readGraphiteConfig } from '../client'
import { branchArg, optionalString } from './shared'

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
