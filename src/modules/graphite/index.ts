import { HomeError } from '../../core/errors'
import type { ModuleManifest } from '../../core/types'
import { probeGraphite, readGraphiteConfig } from './client'
import { branchChildren, branchParent } from './commands/branch'
import { repoTrunk } from './commands/repo'
import { stackGet, stackList, stackValidate } from './commands/stack'

export const manifest: ModuleManifest = {
  name: 'graphite',
  description:
    'Inspect local Graphite stacked-branch state via the gt CLI — stack layout, branch parent/children, PR linkage, trunk, and non-mutating restack-readiness checks',
  whenToUse:
    "Use for what the *local* Graphite metadata knows: which branches are tracked and how they stack (`stack list`), one branch's parent/PR/tip (`stack get`), parent and children navigation (`branch parent` / `branch children`), the trunk (`repo trunk`), and whether a branch is safe to restack (`stack validate` — tracked, parent known, restack marker, clean working tree). All read-only: it never creates, restacks, submits, or deletes branches — run `gt` yourself for mutations. Remote PR state (reviews, CI checks, mergeability, diffs) is the github module's job, not this one's. gt promises no machine output, so every inspect result carries gt's complete raw text in `raw` alongside the best-effort parsed fields — trust `raw` when they disagree. Repository commands need the cwd inside a git working tree; `status` and the version check work anywhere.",
  configSchema: [
    {
      key: 'binaryPath',
      label: 'gt binary path',
      kind: 'string',
      required: true,
      default: 'gt',
      help: 'Path to the Graphite CLI binary (bare `gt` resolves via PATH)',
      hostLocal: true,
    },
    {
      key: 'defaultTrunk',
      label: 'Default trunk branch',
      kind: 'string',
      help: 'Fallback trunk name for readiness checks when `gt trunk` cannot answer; leave empty to trust gt',
    },
  ],
  commands: [stackList, stackGet, stackValidate, branchParent, branchChildren, repoTrunk],
  async status(cfg) {
    try {
      const gc = readGraphiteConfig(cfg)
      const data = await probeGraphite(gc)
      return { ok: true, data }
    } catch (err) {
      if (err instanceof HomeError) {
        return { ok: false, kind: 'system', message: err.message, code: err.code }
      }
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
