import { UserError } from '../../core/errors'
import { runProcess } from '../../core/process'
import { boundRaw, execGt, gtFailure, stripAnsi, type GraphiteConfig, type GtRunner } from './client'

/** sync/submit/merge round-trip to GitHub/Graphite and can rebase many branches. */
const SLOW_ACTION_TIMEOUT_MS = 120_000
/** restack is local-only but rebases the whole stack. */
const RESTACK_TIMEOUT_MS = 60_000
/** create/track touch a single branch locally. */
const QUICK_ACTION_TIMEOUT_MS = 30_000

// Message shapes below were verified against the gt 1.8.6 binary's string
// table (strings(1) over graphite-cli-linux-x64): "Hit a conflict during
// rebase.", "Hit conflict restacking <branch>", "Please resolve conflicts in
// the current stack with ...", "Rebase conflict is not yet resolved.",
// "You must resolve conflicts with ...".
const CONFLICT_RE = /hit (?:a )?conflict|resolve conflicts|rebase conflict/i
// "... is checked out in another worktree.", "... cannot be cleaned up while
// it is checked out in another worktree."
const WORKTREE_RE = /worktree/i
// gt log's "(needs restack)" marker and submit's "could not be restacked".
const NEEDS_RESTACK_RE = /needs restack|could not be restacked/i
// "Deleted branch <name>" / "Deleted empty branch <name>" (sync cleanup).
const DELETED_RE = /^deleted (?:empty )?branch\b/i

export const RESOLVE_MANUALLY_HINT =
  'resolve the conflict manually in the working tree, then run `gt continue` (or abort the rebase) — this module never auto-resolves conflicts'

// gt takes branch names positionally, so a name beginning with `-` is parsed as
// a flag: `-a` becomes gt create's stage-all switch and `-f` becomes a force
// flag, silently breaking the "never stages / never forces" guarantee. gt gives
// no escape — its parser drops everything after a `--` separator from both
// positionals and flags (verified against gt 1.8.6), so `gt create -- <name>`
// discards the name outright. A git branch name cannot legitimately begin with
// `-`, so the only safe course is to reject such a ref before it reaches gt.
function assertNotFlagLike(label: string, ref: string): void {
  if (ref.startsWith('-')) {
    throw new UserError(`${label} ${JSON.stringify(ref)} cannot begin with '-'`, 'bad_arg')
  }
}

function linesMatching(text: string, re: RegExp): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => re.test(line))
}

export interface StackActionResult {
  /** Exactly what ran — the full argv, binary included. */
  command: string[]
  /** gt's complete output (stdout then stderr), ANSI-stripped and bounded. */
  raw: string
  rawTruncated: boolean
  /** gt's conflict / worktree-skip / needs-restack lines, verbatim. */
  conflicts: string[]
  worktreeSkips: string[]
  needsRestack: string[]
  /** Present whenever `conflicts` is nonempty. */
  conflictHint?: string
}

/**
 * Run one mutating gt invocation. Every caller passes `--no-interactive` in
 * `args` and never any force flag. A nonzero exit whose output carries gt's
 * conflict text becomes a `graphite_conflict` UserError with that text
 * verbatim; other nonzero exits go through the shared gtFailure mapping.
 */
async function runGtAction(
  cfg: GraphiteConfig,
  args: readonly string[],
  timeoutMs: number,
  run: GtRunner,
): Promise<StackActionResult> {
  const result = await execGt(cfg, args, { timeoutMs, okExitCodes: [0, 1] }, run)
  const combined = stripAnsi([result.stdout, result.stderr].filter(Boolean).join('\n'))
  const conflicts = linesMatching(combined, CONFLICT_RE)
  if ((result.exitCode ?? -1) !== 0) {
    if (conflicts.length > 0) {
      throw new UserError(`gt halted on a conflict — ${RESOLVE_MANUALLY_HINT}. gt said:\n${conflicts.join('\n')}`, 'graphite_conflict')
    }
    throw gtFailure(args, result)
  }
  return {
    command: [cfg.binaryPath, ...args],
    ...boundRaw(combined, result.stdoutTruncated || result.stderrTruncated),
    conflicts,
    worktreeSkips: linesMatching(combined, WORKTREE_RE),
    needsRestack: linesMatching(combined, NEEDS_RESTACK_RE),
    ...(conflicts.length > 0 ? { conflictHint: RESOLVE_MANUALLY_HINT } : {}),
  }
}

export async function restackStack(
  cfg: GraphiteConfig,
  opts: { branch?: string },
  run: GtRunner = runProcess,
): Promise<StackActionResult> {
  const args = ['restack', ...(opts.branch ? ['--branch', opts.branch] : []), '--no-interactive']
  return runGtAction(cfg, args, RESTACK_TIMEOUT_MS, run)
}

export interface SyncResult extends StackActionResult {
  /** gt's "Deleted branch <name>" lines, verbatim — see syncStack for why these can appear. */
  deletedBranches: string[]
}

export async function syncStack(cfg: GraphiteConfig, run: GtRunner = runProcess): Promise<SyncResult> {
  // gt 1.8.6 sync has no --no-delete flag: its only deletion controls are
  // -f/--force and -d/--delete-all, both of which CAUSE deletion and are never
  // passed. With --no-interactive the delete prompt is suppressed, so merged
  // branches survive — unless the user enabled the sync-cleanup setting in
  // `gt config`, which is why any "Deleted branch" lines gt prints are
  // surfaced verbatim in `deletedBranches`.
  const result = await runGtAction(cfg, ['sync', '--no-interactive'], SLOW_ACTION_TIMEOUT_MS, run)
  return { ...result, deletedBranches: linesMatching(result.raw, DELETED_RE) }
}

export async function submitStack(
  cfg: GraphiteConfig,
  opts: { draft?: boolean; dryRun?: boolean },
  run: GtRunner = runProcess,
): Promise<StackActionResult> {
  // Never -f/--force: gt's default push is --force-with-lease, and --force
  // would drop that protection.
  const args = [
    'submit',
    '--stack',
    ...(opts.draft ? ['--draft'] : []),
    ...(opts.dryRun ? ['--dry-run'] : []),
    '--no-edit',
    '--no-interactive',
  ]
  return runGtAction(cfg, args, SLOW_ACTION_TIMEOUT_MS, run)
}

export async function mergeStack(cfg: GraphiteConfig, run: GtRunner = runProcess): Promise<StackActionResult> {
  // gt 1.8.6 merge has no partial-merge flag (no --through / --branch): it
  // always merges every PR from trunk up to the current branch.
  return runGtAction(cfg, ['merge', '--no-interactive'], SLOW_ACTION_TIMEOUT_MS, run)
}

export async function createBranch(
  cfg: GraphiteConfig,
  name: string,
  message: string,
  run: GtRunner = runProcess,
): Promise<StackActionResult> {
  assertNotFlagLike('branch name', name)
  // No -a/-u/-p: in gt 1.8.6 all staging flags default off, so gt create
  // commits only what is already staged; an empty index yields an empty branch.
  return runGtAction(cfg, ['create', name, '-m', message, '--no-interactive'], QUICK_ACTION_TIMEOUT_MS, run)
}

export async function trackBranch(
  cfg: GraphiteConfig,
  branch: string,
  parent: string,
  run: GtRunner = runProcess,
): Promise<StackActionResult> {
  assertNotFlagLike('branch name', branch)
  assertNotFlagLike('parent', parent)
  // gt 1.8.6 track takes the branch positionally (there is no --branch flag)
  // and the parent via -p/--parent.
  return runGtAction(cfg, ['track', branch, '--parent', parent, '--no-interactive'], QUICK_ACTION_TIMEOUT_MS, run)
}
