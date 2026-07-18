import { HomeError } from '../../core/errors'
import type { ModuleManifest } from '../../core/types'
import { probeGraphite, readGraphiteConfig } from './client'
import { branchChildren, branchCreate, branchParent, branchTrack } from './commands/branch'
import { repoTrunk } from './commands/repo'
import { stackGet, stackList, stackMerge, stackRestack, stackSubmit, stackSync, stackValidate } from './commands/stack'

export const manifest: ModuleManifest = {
  name: 'graphite',
  description:
    'Inspect and act on local Graphite stacked-branch state via the gt CLI — stack layout, branch parent/children, PR linkage, trunk, restack-readiness checks, and confirmed stack mutations (restack, sync, submit, merge, create, track)',
  whenToUse:
    "Use for what the *local* Graphite metadata knows and for guarded stack actions. Reads: which branches are tracked and how they stack (`stack list`), one branch's parent/PR/tip (`stack get`), parent and children navigation (`branch parent` / `branch children`), the trunk (`repo trunk`), and whether a branch is safe to restack (`stack validate` — tracked, parent known, restack marker, clean working tree). Writes — every one requires `--yes` and refuses with confirmation_required otherwise, never prompting interactively: `stack restack --yes`, `stack sync --yes` (never deletes branches itself; any deletion gt performs is surfaced verbatim), `stack submit [--draft] --yes` (`--dry-run` needs no --yes), `stack merge --yes`, `branch create <name> --message <msg> --yes` (commits already-staged changes only), and `branch track <branch> --parent <p> --yes`. Every mutation runs gt with --no-interactive and never a force flag; a merge/rebase conflict comes back as code graphite_conflict with gt's text verbatim — resolve it manually, this module never auto-resolves. Remote PR state (reviews, CI checks, mergeability, diffs) is the github module's job, not this one's. gt promises no machine output, so results carry gt's complete raw text in `raw` alongside the best-effort parsed fields — trust `raw` when they disagree. Repository commands need the cwd inside a git working tree; `status` and the version check work anywhere.",
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
  commands: [
    stackList,
    stackGet,
    stackValidate,
    stackRestack,
    stackSync,
    stackSubmit,
    stackMerge,
    branchParent,
    branchChildren,
    branchCreate,
    branchTrack,
    repoTrunk,
  ],
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
