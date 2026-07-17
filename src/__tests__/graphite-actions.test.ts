import { describe, expect, test } from 'bun:test'
import { HomeError, UserError } from '../core/errors'
import type { ProcessOptions, ProcessResult } from '../core/process'
import type { RunContext, RunResult } from '../core/types'
import { RESOLVE_MANUALLY_HINT, syncStack } from '../modules/graphite/actions'
import type { GtRunner } from '../modules/graphite/client'
import { runBranchCreate, runBranchTrack } from '../modules/graphite/commands/branch'
import { runStackMerge, runStackRestack, runStackSubmit, runStackSync } from '../modules/graphite/commands/stack'
import manifest from '../modules/graphite'

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  }
}

interface Captured {
  argv: string[]
  opts: ProcessOptions | undefined
}

function fakeGt(handler: (argv: string[]) => ProcessResult = () => result()): { run: GtRunner; calls: Captured[] } {
  const calls: Captured[] = []
  const run: GtRunner = async (argv, opts) => {
    calls.push({ argv: [...argv], opts })
    return handler([...argv])
  }
  return { run, calls }
}

function ctx(args: RunContext['args']): RunContext {
  return {
    args,
    json: true,
    quiet: true,
    verbose: false,
    log: null as unknown as RunContext['log'],
    config: {},
  }
}

function errCode(r: RunResult): string | undefined {
  return r.ok ? undefined : r.code
}

async function errorFrom(promise: Promise<unknown>): Promise<HomeError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(HomeError)
    return err as HomeError
  }
  throw new Error('expected rejection')
}

/** Binding rule for the whole action layer: no force flag, ever. */
const FORCE_FLAGS = ['-f', '--force', '-d', '--delete-all']

function expectGuardedArgv(argv: string[]): void {
  expect(argv).toContain('--no-interactive')
  for (const flag of FORCE_FLAGS) expect(argv).not.toContain(flag)
}

// ---------------------------------------------------------------------------
// Fixtures shaped from the gt 1.8.6 binary's message strings (strings(1) over
// graphite-cli-linux-x64, 2026-07-17) — gt promises no machine output.

const REAL_CONFLICT_TEXT =
  'Hit conflict restacking feat/unifi-networks-get on main.\nPlease resolve conflicts in the current stack with `gt continue`.\n'
const REAL_WORKTREE_SKIP =
  'Skipping codex/github-more-reads because it is checked out in another worktree at /home/mikeupton/Projects/home-dev.\n'
const REAL_SYNC_DELETION = 'Deleted branch feat/old-thing (merged)\nDeleted empty branch scratch/tmp\n'

// ---------------------------------------------------------------------------
// confirmation gates: every write refuses without --yes, running NOTHING

const WRITE_COMMANDS: Array<{
  name: string
  invoke: (c: RunContext, run: GtRunner) => Promise<RunResult>
  args: RunContext['args']
}> = [
  { name: 'stack restack', invoke: runStackRestack, args: {} },
  { name: 'stack sync', invoke: runStackSync, args: {} },
  { name: 'stack submit', invoke: runStackSubmit, args: {} },
  { name: 'stack merge', invoke: runStackMerge, args: {} },
  { name: 'branch create', invoke: runBranchCreate, args: { name: 'feat/x', message: 'feat: x' } },
  { name: 'branch track', invoke: runBranchTrack, args: { branch: 'feat/x', parent: 'main' } },
]

describe('confirmation gate', () => {
  for (const cmd of WRITE_COMMANDS) {
    test(`${cmd.name} without --yes → confirmation_required, zero gt invocations`, async () => {
      const { run, calls } = fakeGt()
      const r = await cmd.invoke(ctx(cmd.args), run)
      expect(errCode(r)).toBe('confirmation_required')
      expect(r.ok ? '' : r.message).toContain('--yes')
      expect(calls).toHaveLength(0)
    })
  }

  test('every registered graphite write command carries a yes flag', () => {
    const writes = manifest.commands.filter((c) => c.effect !== 'read')
    expect(writes.map((c) => c.path.join(' ')).sort()).toEqual([
      'branch create',
      'branch track',
      'stack merge',
      'stack restack',
      'stack submit',
      'stack sync',
    ])
    for (const c of writes) {
      expect(c.effect).toBe('write')
      expect(c.args.some((a) => a.name === 'yes' && a.kind === 'boolean')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// argv snapshots: exactly what runs, --no-interactive always, no force ever

describe('argv shapes (gt 1.8.6)', () => {
  test('stack restack --yes', async () => {
    const { run, calls } = fakeGt()
    const r = await runStackRestack(ctx({ yes: true }), run)
    expect(r.ok).toBe(true)
    expect(calls[0]!.argv).toEqual(['gt', 'restack', '--no-interactive'])
    expectGuardedArgv(calls[0]!.argv)
  })

  test('stack restack --branch b --yes', async () => {
    const { run, calls } = fakeGt()
    await runStackRestack(ctx({ yes: true, branch: 'feat/my-branch' }), run)
    expect(calls[0]!.argv).toEqual(['gt', 'restack', '--branch', 'feat/my-branch', '--no-interactive'])
  })

  test('stack sync --yes never passes a deletion or force flag', async () => {
    const { run, calls } = fakeGt()
    await runStackSync(ctx({ yes: true }), run)
    expect(calls[0]!.argv).toEqual(['gt', 'sync', '--no-interactive'])
    expectGuardedArgv(calls[0]!.argv)
  })

  test('stack submit --yes', async () => {
    const { run, calls } = fakeGt()
    await runStackSubmit(ctx({ yes: true }), run)
    expect(calls[0]!.argv).toEqual(['gt', 'submit', '--stack', '--no-edit', '--no-interactive'])
    expectGuardedArgv(calls[0]!.argv)
  })

  test('stack submit --draft --yes', async () => {
    const { run, calls } = fakeGt()
    await runStackSubmit(ctx({ yes: true, draft: true }), run)
    expect(calls[0]!.argv).toEqual(['gt', 'submit', '--stack', '--draft', '--no-edit', '--no-interactive'])
  })

  test('stack merge --yes (gt 1.8.6 has no partial-merge flag)', async () => {
    const { run, calls } = fakeGt()
    await runStackMerge(ctx({ yes: true }), run)
    expect(calls[0]!.argv).toEqual(['gt', 'merge', '--no-interactive'])
    expectGuardedArgv(calls[0]!.argv)
  })

  test('branch create passes name and -m message, never a staging flag', async () => {
    const { run, calls } = fakeGt()
    await runBranchCreate(ctx({ yes: true, name: 'feat/x', message: 'feat: add x' }), run)
    expect(calls[0]!.argv).toEqual(['gt', 'create', 'feat/x', '-m', 'feat: add x', '--no-interactive'])
    expect(calls[0]!.argv).not.toContain('-a')
    expect(calls[0]!.argv).not.toContain('--all')
    expect(calls[0]!.argv).not.toContain('-u')
    expectGuardedArgv(calls[0]!.argv)
  })

  test('branch track passes the branch positionally with --parent (gt 1.8.6 has no --branch flag)', async () => {
    const { run, calls } = fakeGt()
    await runBranchTrack(ctx({ yes: true, branch: 'feat/x', parent: 'main' }), run)
    expect(calls[0]!.argv).toEqual(['gt', 'track', 'feat/x', '--parent', 'main', '--no-interactive'])
    expectGuardedArgv(calls[0]!.argv)
  })

  test('every action echoes its exact argv in the result', async () => {
    const { run } = fakeGt()
    const r = await runStackSubmit(ctx({ yes: true }), run)
    expect(r.ok).toBe(true)
    expect((r as { ok: true; data: { command: string[] } }).data.command).toEqual([
      'gt',
      'submit',
      '--stack',
      '--no-edit',
      '--no-interactive',
    ])
  })
})

// ---------------------------------------------------------------------------
// dry-run submit: reporting only, so --yes is not required

describe('submit --dry-run', () => {
  test('runs without --yes and forwards --dry-run', async () => {
    const { run, calls } = fakeGt(() => result({ stdout: 'Would submit 3 PRs\n' }))
    const r = await runStackSubmit(ctx({ 'dry-run': true }), run)
    expect(r.ok).toBe(true)
    expect(calls[0]!.argv).toEqual(['gt', 'submit', '--stack', '--dry-run', '--no-edit', '--no-interactive'])
  })

  test('with --yes as well it still dry-runs', async () => {
    const { run, calls } = fakeGt()
    await runStackSubmit(ctx({ 'dry-run': true, yes: true }), run)
    expect(calls[0]!.argv).toContain('--dry-run')
  })
})

// ---------------------------------------------------------------------------
// arg validation (before the yes gate, still zero invocations)

describe('required args', () => {
  test('branch create without a message → missing_arg, nothing runs', async () => {
    const { run, calls } = fakeGt()
    expect(errCode(await runBranchCreate(ctx({ yes: true, name: 'feat/x' }), run))).toBe('missing_arg')
    expect(calls).toHaveLength(0)
  })

  test('branch track without a parent → missing_arg, nothing runs', async () => {
    const { run, calls } = fakeGt()
    expect(errCode(await runBranchTrack(ctx({ yes: true, branch: 'feat/x' }), run))).toBe('missing_arg')
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// flag-like refs: a dash-leading name/parent would be parsed by gt as a flag
// (`-a` → stage-all, `-f` → force), so the guard rejects it before any spawn

describe('flag-like ref rejection', () => {
  test('branch create with a dash-leading name → bad_arg, gt never runs', async () => {
    const { run, calls } = fakeGt()
    const err = await errorFrom(runBranchCreate(ctx({ yes: true, name: '-a', message: 'feat: x' }), run))
    expect(err).toBeInstanceOf(UserError)
    expect(err.code).toBe('bad_arg')
    expect(calls).toHaveLength(0)
  })

  test('branch track with a dash-leading branch → bad_arg, gt never runs', async () => {
    const { run, calls } = fakeGt()
    const err = await errorFrom(runBranchTrack(ctx({ yes: true, branch: '-f', parent: 'main' }), run))
    expect(err).toBeInstanceOf(UserError)
    expect(err.code).toBe('bad_arg')
    expect(calls).toHaveLength(0)
  })

  test('branch track with a dash-leading parent → bad_arg, gt never runs', async () => {
    const { run, calls } = fakeGt()
    const err = await errorFrom(runBranchTrack(ctx({ yes: true, branch: 'feat/x', parent: '-f' }), run))
    expect(err).toBeInstanceOf(UserError)
    expect(err.code).toBe('bad_arg')
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// conflicts: never auto-resolved, gt's text verbatim, stable code

describe('conflicts', () => {
  test('restack halting on a conflict → graphite_conflict with gt text verbatim + manual hint', async () => {
    const { run } = fakeGt(() => result({ exitCode: 1, stderr: REAL_CONFLICT_TEXT }))
    const err = await errorFrom(runStackRestack(ctx({ yes: true }), run))
    expect(err).toBeInstanceOf(UserError)
    expect(err.code).toBe('graphite_conflict')
    expect(err.message).toContain('Hit conflict restacking feat/unifi-networks-get on main.')
    expect(err.message).toContain(RESOLVE_MANUALLY_HINT)
  })

  test('a nonzero exit without conflict text still maps through gtFailure', async () => {
    const { run } = fakeGt(() => result({ exitCode: 1, stderr: 'ERROR: You must run this command from within a git repository. \n' }))
    const err = await errorFrom(runStackSync(ctx({ yes: true }), run))
    expect(err.code).toBe('graphite_not_repo')
  })

  test('exit-0 sync that skipped conflicted branches surfaces the lines verbatim with a hint field', async () => {
    const stdout = `Restacked codex/gcal-read on main.\n${REAL_CONFLICT_TEXT}`
    const { run } = fakeGt(() => result({ stdout }))
    const r = await runStackSync(ctx({ yes: true }), run)
    expect(r.ok).toBe(true)
    const data = (r as { ok: true; data: { conflicts: string[]; conflictHint?: string; raw: string } }).data
    expect(data.conflicts).toEqual([
      'Hit conflict restacking feat/unifi-networks-get on main.',
      'Please resolve conflicts in the current stack with `gt continue`.',
    ])
    expect(data.conflictHint).toBe(RESOLVE_MANUALLY_HINT)
    expect(data.raw).toContain('Restacked codex/gcal-read on main.')
  })
})

// ---------------------------------------------------------------------------
// worktree skips + needs-restack markers surfaced verbatim

describe('verbatim surfacing', () => {
  test('worktree skips land in worktreeSkips', async () => {
    const { run } = fakeGt(() => result({ stdout: REAL_WORKTREE_SKIP }))
    const r = await runStackRestack(ctx({ yes: true }), run)
    const data = (r as { ok: true; data: { worktreeSkips: string[] } }).data
    expect(data.worktreeSkips).toEqual([
      'Skipping codex/github-more-reads because it is checked out in another worktree at /home/mikeupton/Projects/home-dev.',
    ])
  })

  test('needs-restack text lands in needsRestack', async () => {
    const { run } = fakeGt(() => result({ stdout: 'codex/github-read (needs restack)\n' }))
    const r = await runStackSubmit(ctx({ yes: true }), run)
    const data = (r as { ok: true; data: { needsRestack: string[] } }).data
    expect(data.needsRestack).toEqual(['codex/github-read (needs restack)'])
  })

  test('stderr is preserved in raw alongside stdout', async () => {
    const { run } = fakeGt(() => result({ stdout: 'Pushed feat/x\n', stderr: 'warning: something advisory\n' }))
    const r = await runStackSubmit(ctx({ yes: true }), run)
    const data = (r as { ok: true; data: { raw: string } }).data
    expect(data.raw).toContain('Pushed feat/x')
    expect(data.raw).toContain('warning: something advisory')
  })
})

// ---------------------------------------------------------------------------
// sync deletion policy: no flag exists in gt 1.8.6 to forbid deletion, so any
// deletion gt performs (sync-cleanup config) is surfaced verbatim

describe('sync deletions', () => {
  test('deleted-branch lines are surfaced verbatim in deletedBranches', async () => {
    const { run } = fakeGt(() => result({ stdout: REAL_SYNC_DELETION }))
    const sync = await syncStack({ binaryPath: 'gt' }, run)
    expect(sync.deletedBranches).toEqual(['Deleted branch feat/old-thing (merged)', 'Deleted empty branch scratch/tmp'])
  })

  test('a clean sync reports no deletions', async () => {
    const { run } = fakeGt(() => result({ stdout: 'main is up to date.\n' }))
    const sync = await syncStack({ binaryPath: 'gt' }, run)
    expect(sync.deletedBranches).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// timeout plumbing: slow remote actions get 120s, restack 60s, quick ones 30s

describe('timeouts', () => {
  const expectTimeout = (calls: Captured[], ms: number) => expect(calls[0]!.opts?.timeoutMs).toBe(ms)

  test('sync, submit, and merge run with 120s', async () => {
    for (const invoke of [runStackSync, runStackSubmit, runStackMerge]) {
      const { run, calls } = fakeGt()
      await invoke(ctx({ yes: true }), run)
      expectTimeout(calls, 120_000)
    }
  })

  test('restack runs with 60s', async () => {
    const { run, calls } = fakeGt()
    await runStackRestack(ctx({ yes: true }), run)
    expectTimeout(calls, 60_000)
  })

  test('create and track run with 30s', async () => {
    const create = fakeGt()
    await runBranchCreate(ctx({ yes: true, name: 'feat/x', message: 'feat: x' }), create.run)
    expectTimeout(create.calls, 30_000)

    const track = fakeGt()
    await runBranchTrack(ctx({ yes: true, branch: 'feat/x', parent: 'main' }), track.run)
    expectTimeout(track.calls, 30_000)
  })
})
