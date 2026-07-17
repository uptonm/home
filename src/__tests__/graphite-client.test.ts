import { describe, expect, test } from 'bun:test'
import { HomeError, SystemError, UserError } from '../core/errors'
import type { ProcessOptions, ProcessResult } from '../core/process'
import {
  getBranchInfo,
  getChildren,
  getGtVersion,
  getParent,
  getTrunk,
  listStack,
  parseGtVersion,
  parseLogShort,
  probeGraphite,
  readGraphiteConfig,
  stripAnsi,
  TESTED_GT_VERSION,
  validateBranch,
  type GraphiteConfig,
  type GtRunner,
} from '../modules/graphite/client'

const CFG: GraphiteConfig = { binaryPath: 'gt' }

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

/** Fake runProcess: routes on the exact argv and returns canned results. */
function fakeGt(handler: (argv: string[]) => ProcessResult): { run: GtRunner; calls: Captured[] } {
  const calls: Captured[] = []
  const run: GtRunner = async (argv, opts) => {
    calls.push({ argv: [...argv], opts })
    return handler([...argv])
  }
  return { run, calls }
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

// ---------------------------------------------------------------------------
// Fixtures captured verbatim from gt 1.8.6 in ~/Projects/home (2026-07-17).

const REAL_LOG_SHORT = `◯          codex/gcal-agenda (home-plan)
◯          codex/gcal-read
│ ◯        codex/github-more-reads (home-dev)
│ ◯        codex/github-read
│ ◯        codex/process-adapter
│ │ ◯      codex/vercel-control-plane (home-ops)
│ │ ◯      codex/vercel-config-namespace
│ │ │ ◯    feat/unifi-clients-get-v2
│ │ │ ◯    feat/unifi-firewall-commands
│ │ │ ◯    feat/unifi-networks-get
│ │ │ │ ◯  sonos-cross-vlan-discovery
◉─┴─┴─┴─┘  main
`

/** gt info colorizes the git-log passthrough (ESC[33m) even when piped. */
const REAL_INFO_TRACKED = `codex/github-read
10 minutes ago

PR #71 (Draft) feat(github): add read-only github module over the gh CLI
https://app.graphite.com/github/pr/uptonm/home/71
Last submitted version: v1

Parent: codex/process-adapter
Children:

[33mcommit a6ad9ab42e8fb27dfe3768614e8e03d6cb487128[m
Author: Mike Upton <uptonm.dev@gmail.com>
Date:   Fri Jul 17 04:08:23 2026 +0000

    feat(github): add read-only github module over the gh CLI
`

/** gt info on trunk: no PR, no Parent line, and Children: renders empty despite main having five children. */
const REAL_INFO_TRUNK = `main
44 minutes ago

Children:

[33mcommit 5cb54f927a28ff36cdbc034407073836d8dab6cd[m
Author: Mike Upton <uptonm.dev@gmail.com>
Date:   Thu Jul 16 23:34:20 2026 -0400

    E2E test harness: effect classification + live runner (#66)
`

const REAL_ERR_NOT_REPO = 'ERROR: You must run this command from within a git repository. \n'
const REAL_ERR_TRUNK_PARENT = 'ERROR: Cannot perform this operation on the trunk branch. \n'
const REAL_ERR_UNTRACKED =
  'ERROR: Cannot perform this operation on untracked branch claude/gdrive-module.\nYou can track it by specifying its parent with gt track. \n'
const REAL_ERR_NOT_FOUND = 'ERROR: Could not find branch no-such-branch-xyz. \n'
const REAL_CHILDREN_OF_TRUNK =
  'sonos-cross-vlan-discovery\nfeat/unifi-networks-get\ncodex/vercel-config-namespace\ncodex/process-adapter\ncodex/gcal-read\n'
const REAL_PARENT_LINE = 'codex/github-read\n'
const REAL_VERSION = '1.8.6\n'

/** Real topology of the fixture repo, used to synthesize gt info responses for fan-out routes. */
const PARENTS: Record<string, string | null> = {
  'codex/gcal-agenda': 'codex/gcal-read',
  'codex/gcal-read': 'main',
  'codex/github-more-reads': 'codex/github-read',
  'codex/github-read': 'codex/process-adapter',
  'codex/process-adapter': 'main',
  'codex/vercel-control-plane': 'codex/vercel-config-namespace',
  'codex/vercel-config-namespace': 'main',
  'feat/unifi-clients-get-v2': 'feat/unifi-firewall-commands',
  'feat/unifi-firewall-commands': 'feat/unifi-networks-get',
  'feat/unifi-networks-get': 'main',
  'sonos-cross-vlan-discovery': 'main',
  main: null,
}

function infoFor(branch: string): string {
  const parent = PARENTS[branch]
  return `${branch}\n2 minutes ago\n${parent ? `\nParent: ${parent}\n` : ''}Children:\n\ncommit abc1234def\n`
}

/** Routes gt log short + per-branch gt info like the real repo; git status is clean. */
function repoHandler(argv: string[]): ProcessResult {
  const cmd = argv.join(' ')
  if (argv[0] === 'git') return result({ stdout: '' })
  if (cmd.startsWith('gt log short')) return result({ stdout: REAL_LOG_SHORT })
  if (argv[1] === 'info' && argv[2] === '--branch') {
    const branch = argv[3] ?? ''
    if (!(branch in PARENTS)) {
      return result({ exitCode: 1, stderr: `ERROR: Could not find branch ${branch}. \n` })
    }
    return result({ stdout: infoFor(branch) })
  }
  if (argv[1] === 'trunk') return result({ stdout: 'main\n' })
  throw new Error(`unrouted argv: ${cmd}`)
}

// ---------------------------------------------------------------------------

describe('readGraphiteConfig', () => {
  test('defaults binaryPath to gt and omits defaultTrunk', () => {
    expect(readGraphiteConfig({})).toEqual({ binaryPath: 'gt' })
  })

  test('keeps explicit values', () => {
    expect(readGraphiteConfig({ binaryPath: '/opt/gt', defaultTrunk: 'develop' })).toEqual({
      binaryPath: '/opt/gt',
      defaultTrunk: 'develop',
    })
  })
})

describe('version', () => {
  test('parses the real gt --version output as compatible', () => {
    expect(parseGtVersion(REAL_VERSION)).toEqual({
      version: '1.8.6',
      major: 1,
      minor: 8,
      patch: 6,
      compatible: true,
      testedVersion: TESTED_GT_VERSION,
    })
  })

  test('an untested major parses but is flagged incompatible', () => {
    expect(parseGtVersion('2.0.1\n')?.compatible).toBe(false)
  })

  test('no semver → null; getGtVersion turns that into graphite_failed', async () => {
    expect(parseGtVersion('flagrant nonsense')).toBeNull()
    const { run } = fakeGt(() => result({ stdout: 'flagrant nonsense' }))
    const err = await errorFrom(getGtVersion(CFG, run))
    expect(err.code).toBe('graphite_failed')
  })

  test('gt binary missing → graphite_gt_missing', async () => {
    const run: GtRunner = async () => {
      throw new SystemError('binary not found: gt', 'process_not_found')
    }
    const err = await errorFrom(getGtVersion(CFG, run))
    expect(err.code).toBe('graphite_gt_missing')
  })

  test('uses the configured binaryPath as argv[0]', async () => {
    const { run, calls } = fakeGt(() => result({ stdout: REAL_VERSION }))
    await getGtVersion({ binaryPath: '/opt/homebrew/bin/gt' }, run)
    expect(calls[0]!.argv).toEqual(['/opt/homebrew/bin/gt', '--version'])
  })
})

describe('trunk', () => {
  test('returns the single-line trunk name', async () => {
    const { run, calls } = fakeGt(() => result({ stdout: 'main\n' }))
    expect(await getTrunk(CFG, run)).toBe('main')
    expect(calls[0]!.argv).toEqual(['gt', 'trunk', '--no-interactive'])
  })

  test('outside a git repository → graphite_not_repo', async () => {
    const { run } = fakeGt(() => result({ exitCode: 1, stderr: REAL_ERR_NOT_REPO }))
    const err = await errorFrom(getTrunk(CFG, run))
    expect(err).toBeInstanceOf(UserError)
    expect(err.code).toBe('graphite_not_repo')
  })
})

describe('parent', () => {
  test('current branch: single-line stdout becomes the parent', async () => {
    const { run, calls } = fakeGt(() => result({ stdout: REAL_PARENT_LINE }))
    expect(await getParent(CFG, undefined, run)).toEqual({
      branch: null,
      parent: 'codex/github-read',
      isTrunk: false,
    })
    expect(calls[0]!.argv).toEqual(['gt', 'parent', '--no-interactive'])
  })

  test('on trunk gt exits 1 with a trunk message → parent null, isTrunk true', async () => {
    const { run } = fakeGt(() => result({ exitCode: 1, stderr: REAL_ERR_TRUNK_PARENT }))
    expect(await getParent(CFG, undefined, run)).toEqual({ branch: null, parent: null, isTrunk: true })
  })

  test('exit 1 without the trunk message still maps to an error', async () => {
    const { run } = fakeGt(() => result({ exitCode: 1, stderr: REAL_ERR_NOT_REPO }))
    const err = await errorFrom(getParent(CFG, undefined, run))
    expect(err.code).toBe('graphite_not_repo')
  })

  test('named branch goes through gt info --branch (gt 1.8.6 parent takes no argument)', async () => {
    const { run, calls } = fakeGt(() => result({ stdout: REAL_INFO_TRACKED }))
    expect(await getParent(CFG, 'codex/github-read', run)).toEqual({
      branch: 'codex/github-read',
      parent: 'codex/process-adapter',
      isTrunk: false,
    })
    expect(calls[0]!.argv).toEqual(['gt', 'info', '--branch', 'codex/github-read', '--no-interactive'])
  })
})

describe('children', () => {
  test('current branch: one name per line', async () => {
    const { run, calls } = fakeGt(() => result({ stdout: REAL_CHILDREN_OF_TRUNK }))
    expect(await getChildren(CFG, undefined, run)).toEqual({
      branch: null,
      children: [
        'sonos-cross-vlan-discovery',
        'feat/unifi-networks-get',
        'codex/vercel-config-namespace',
        'codex/process-adapter',
        'codex/gcal-read',
      ],
      derived: false,
    })
    expect(calls[0]!.argv).toEqual(['gt', 'children', '--no-interactive'])
  })

  test('leaf branch: empty stdout, exit 0 → no children (gt prints nothing)', async () => {
    const { run } = fakeGt(() => result({ stdout: '' }))
    expect(await getChildren(CFG, undefined, run)).toEqual({ branch: null, children: [], derived: false })
  })

  test('named branch: derived from per-branch parent lookups, bounded', async () => {
    const { run } = fakeGt(repoHandler)
    const info = await getChildren(CFG, 'codex/github-read', run)
    expect(info.children).toEqual(['codex/github-more-reads'])
    expect(info.derived).toBe(true)
    expect(info.truncated).toBe(false)
  })

  test('named trunk: all first-level branches come back', async () => {
    const { run } = fakeGt(repoHandler)
    const info = await getChildren(CFG, 'main', run)
    expect(info.children!.sort()).toEqual([
      'codex/gcal-read',
      'codex/process-adapter',
      'codex/vercel-config-namespace',
      'feat/unifi-networks-get',
      'sonos-cross-vlan-discovery',
    ])
  })

  test('a branch absent from gt log short → graphite_failed user error', async () => {
    const { run } = fakeGt(repoHandler)
    const err = await errorFrom(getChildren(CFG, 'claude/gdrive-module', run))
    expect(err).toBeInstanceOf(UserError)
    expect(err.code).toBe('graphite_failed')
    expect(err.message).toContain('not tracked')
  })
})

describe('parseLogShort', () => {
  test('extracts every tracked branch, in order, from the real output', () => {
    const names = parseLogShort(REAL_LOG_SHORT).map((b) => b.name)
    expect(names).toEqual([
      'codex/gcal-agenda',
      'codex/gcal-read',
      'codex/github-more-reads',
      'codex/github-read',
      'codex/process-adapter',
      'codex/vercel-control-plane',
      'codex/vercel-config-namespace',
      'feat/unifi-clients-get-v2',
      'feat/unifi-firewall-commands',
      'feat/unifi-networks-get',
      'sonos-cross-vlan-discovery',
      'main',
    ])
  })

  test('never leaks graph glyphs into names, and captures the parenthetical note', () => {
    const branches = parseLogShort(REAL_LOG_SHORT)
    for (const b of branches) {
      expect(b.name).not.toMatch(/[◯◉│─┴┘]/)
    }
    expect(branches.find((b) => b.name === 'codex/github-more-reads')?.note).toBe('home-dev')
    expect(branches.find((b) => b.name === 'main')?.note).toBeNull()
  })

  test('flags a needs-restack marker on the branch line', () => {
    const line = '│ ◯        feat/unifi-networks-get (needs restack)\n'
    const [branch] = parseLogShort(line)
    expect(branch).toMatchObject({ name: 'feat/unifi-networks-get', needsRestack: true })
    expect(parseLogShort(REAL_LOG_SHORT).some((b) => b.needsRestack)).toBe(false)
  })
})

describe('stack list', () => {
  test('preserves the complete raw gt output and attaches looked-up parents', async () => {
    const { run } = fakeGt(repoHandler)
    const stack = await listStack(CFG, {}, run)
    expect(stack.raw).toBe(REAL_LOG_SHORT)
    expect(stack.rawTruncated).toBe(false)
    expect(stack.topology).toEqual({ scanned: 12, truncated: false })
    const byName = new Map(stack.branches.map((b) => [b.name, b]))
    expect(byName.get('codex/github-more-reads')?.parent).toBe('codex/github-read')
    expect(byName.get('main')?.parent).toBeNull()
  })

  test('--all is forwarded to gt log short', async () => {
    const { run, calls } = fakeGt(repoHandler)
    await listStack(CFG, { all: true }, run)
    expect(calls[0]!.argv).toEqual(['gt', 'log', 'short', '--all', '--no-interactive'])
  })

  test('outside a git repository → graphite_not_repo', async () => {
    const { run } = fakeGt(() => result({ exitCode: 1, stderr: REAL_ERR_NOT_REPO }))
    const err = await errorFrom(listStack(CFG, {}, run))
    expect(err.code).toBe('graphite_not_repo')
  })
})

describe('stack get (gt info)', () => {
  test('parses branch, parent, PR, URL, and tip commit from the real output', async () => {
    const { run } = fakeGt(() => result({ stdout: REAL_INFO_TRACKED }))
    const info = await getBranchInfo(CFG, 'codex/github-read', run)
    expect(info.branch).toBe('codex/github-read')
    expect(info.parent).toBe('codex/process-adapter')
    expect(info.pr).toEqual({
      number: 71,
      state: 'Draft',
      title: 'feat(github): add read-only github module over the gh CLI',
    })
    expect(info.prUrl).toBe('https://app.graphite.com/github/pr/uptonm/home/71')
    expect(info.commit).toBe('a6ad9ab42e8fb27dfe3768614e8e03d6cb487128')
    expect(info.raw).toContain('Last submitted version: v1')
    expect(info.raw).not.toContain('\u001b')
    expect(info.rawTruncated).toBe(false)
  })

  test('trunk info has no PR and no parent', async () => {
    const { run } = fakeGt(() => result({ stdout: REAL_INFO_TRUNK }))
    const info = await getBranchInfo(CFG, undefined, run)
    expect(info.branch).toBe('main')
    expect(info.parent).toBeNull()
    expect(info.pr).toBeNull()
    expect(info.commit).toBe('5cb54f927a28ff36cdbc034407073836d8dab6cd')
  })

  test('untracked branch → graphite_failed with gt text preserved', async () => {
    const { run } = fakeGt(() => result({ exitCode: 1, stderr: REAL_ERR_UNTRACKED }))
    const err = await errorFrom(getBranchInfo(CFG, 'claude/gdrive-module', run))
    expect(err).toBeInstanceOf(UserError)
    expect(err.code).toBe('graphite_failed')
    expect(err.message).toContain('untracked branch claude/gdrive-module')
  })

  test('unknown branch → graphite_failed with gt text preserved', async () => {
    const { run } = fakeGt(() => result({ exitCode: 1, stderr: REAL_ERR_NOT_FOUND }))
    const err = await errorFrom(getBranchInfo(CFG, 'no-such-branch-xyz', run))
    expect(err.code).toBe('graphite_failed')
    expect(err.message).toContain('Could not find branch')
  })
})

describe('stack validate', () => {
  function validateHandler(overrides: {
    info?: ProcessResult
    log?: ProcessResult
    git?: ProcessResult
  }): (argv: string[]) => ProcessResult {
    return (argv) => {
      if (argv[0] === 'git') return overrides.git ?? result({ stdout: '' })
      if (argv[1] === 'info') return overrides.info ?? result({ stdout: REAL_INFO_TRACKED })
      if (argv[1] === 'log') return overrides.log ?? result({ stdout: REAL_LOG_SHORT })
      if (argv[1] === 'trunk') return result({ stdout: 'main\n' })
      throw new Error(`unrouted argv: ${argv.join(' ')}`)
    }
  }

  test('tracked branch with parent, no restack marker, clean tree → ready', async () => {
    const { run } = fakeGt(validateHandler({}))
    const report = await validateBranch(CFG, 'codex/github-read', run)
    expect(report.branch).toBe('codex/github-read')
    expect(report.ready).toBe(true)
    expect(report.findings.map((f) => [f.check, f.ok])).toEqual([
      ['tracked', true],
      ['parent', true],
      ['restack', true],
      ['clean_worktree', true],
    ])
  })

  test('untracked branch → tracked blocker with gt text, not ready, no throw', async () => {
    const { run } = fakeGt(validateHandler({ info: result({ exitCode: 1, stderr: REAL_ERR_UNTRACKED }) }))
    const report = await validateBranch(CFG, 'claude/gdrive-module', run)
    expect(report.ready).toBe(false)
    const tracked = report.findings.find((f) => f.check === 'tracked')!
    expect(tracked.ok).toBe(false)
    expect(tracked.detail).toContain('untracked branch claude/gdrive-module')
  })

  test('dirty working tree → clean_worktree blocker with a path count', async () => {
    const { run } = fakeGt(validateHandler({ git: result({ stdout: ' M src/index.ts\n?? scratch.ts\n' }) }))
    const report = await validateBranch(CFG, 'codex/github-read', run)
    expect(report.ready).toBe(false)
    const clean = report.findings.find((f) => f.check === 'clean_worktree')!
    expect(clean.ok).toBe(false)
    expect(clean.detail).toContain('2 paths')
  })

  test('needs-restack marker in gt log → restack blocker', async () => {
    const marked = REAL_LOG_SHORT.replace('│ ◯        codex/github-read', '│ ◯        codex/github-read (needs restack)')
    const { run } = fakeGt(validateHandler({ log: result({ stdout: marked }) }))
    const report = await validateBranch(CFG, 'codex/github-read', run)
    expect(report.ready).toBe(false)
    expect(report.findings.find((f) => f.check === 'restack')?.ok).toBe(false)
  })

  test('trunk has no parent and that is fine', async () => {
    const { run } = fakeGt(validateHandler({ info: result({ stdout: REAL_INFO_TRUNK }) }))
    const report = await validateBranch(CFG, undefined, run)
    expect(report.branch).toBe('main')
    const parent = report.findings.find((f) => f.check === 'parent')!
    expect(parent.ok).toBe(true)
    expect(parent.detail).toContain('trunk')
  })
})

describe('status probe', () => {
  test('inside a repo: version + repository with trunk', async () => {
    const { run } = fakeGt((argv) =>
      argv[1] === '--version' || argv[1] === undefined
        ? result({ stdout: REAL_VERSION })
        : result({ stdout: 'main\n' }),
    )
    expect(await probeGraphite(CFG, run)).toEqual({
      binaryPath: 'gt',
      version: '1.8.6',
      compatible: true,
      testedVersion: TESTED_GT_VERSION,
      repository: { initialized: true, trunk: 'main' },
    })
  })

  test('outside a repo: repository null, probe still succeeds', async () => {
    const { run } = fakeGt((argv) =>
      argv.includes('--version')
        ? result({ stdout: REAL_VERSION })
        : result({ exitCode: 1, stderr: REAL_ERR_NOT_REPO }),
    )
    const status = await probeGraphite(CFG, run)
    expect(status.repository).toBeNull()
    expect(status.version).toBe('1.8.6')
  })

  test('untested major version: compatible false, probe still returns data', async () => {
    const { run } = fakeGt((argv) =>
      argv.includes('--version') ? result({ stdout: '2.1.0\n' }) : result({ stdout: 'main\n' }),
    )
    const status = await probeGraphite(CFG, run)
    expect(status.compatible).toBe(false)
    expect(status.repository).toEqual({ initialized: true, trunk: 'main' })
  })

  test('missing binary fails the probe with graphite_gt_missing', async () => {
    const run: GtRunner = async () => {
      throw new SystemError('binary not found: gt', 'process_not_found')
    }
    const err = await errorFrom(probeGraphite(CFG, run))
    expect(err.code).toBe('graphite_gt_missing')
  })
})

describe('ansi handling', () => {
  test('stripAnsi removes gt/git color sequences', () => {
    expect(stripAnsi('\u001b[33mcommit abc\u001b[m')).toBe('commit abc')
  })
})
