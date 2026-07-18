import { describe, expect, test } from 'bun:test'
import { HomeError, UserError } from '../core/errors'
import type { ProcessOptions, ProcessResult } from '../core/process'
import {
  getSummary,
  listNotifications,
  listReleases,
  repoFromUrl,
  searchCode,
  summarizeRollup,
  type GhRunner,
  type GithubConfig,
} from '../modules/github/client'

const CFG: GithubConfig = { host: 'github.com', binaryPath: 'gh' }

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

/** Fake runProcess: captures the exact argv and returns a canned result. */
function fakeGh(canned: ProcessResult | ((argv: string[]) => ProcessResult)): { run: GhRunner; calls: Captured[] } {
  const calls: Captured[] = []
  const run: GhRunner = async (argv, opts) => {
    calls.push({ argv: [...argv], opts })
    return typeof canned === 'function' ? canned([...argv]) : canned
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

const NOTIFICATION = (over: Record<string, unknown> = {}) => ({
  id: '24425097974',
  unread: true,
  reason: 'review_requested',
  updated_at: '2026-07-14T20:58:39Z',
  subject: { title: 'Bump webpack', url: 'https://api.github.com/repos/a/b/pulls/8000', type: 'PullRequest' },
  repository: { full_name: 'a/b' },
  ...over,
})

describe('notifications', () => {
  test('fetches one bounded page and normalizes rows', async () => {
    const { run, calls } = fakeGh(result({ stdout: JSON.stringify([NOTIFICATION()]) }))
    const items = await listNotifications(CFG, { limit: 10 }, run)
    expect(calls[0]!.argv).toEqual(['gh', 'api', 'notifications?per_page=10'])
    expect(items).toEqual([
      {
        id: '24425097974',
        reason: 'review_requested',
        repo: 'a/b',
        title: 'Bump webpack',
        type: 'PullRequest',
        url: 'https://api.github.com/repos/a/b/pulls/8000',
        updatedAt: '2026-07-14T20:58:39Z',
        unread: true,
      },
    ])
  })

  test('default limit, and per_page never exceeds the API cap of 50', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await listNotifications(CFG, {}, run)
    await listNotifications(CFG, { limit: 100 }, run)
    expect(calls[0]!.argv[2]).toBe('notifications?per_page=30')
    expect(calls[1]!.argv[2]).toBe('notifications?per_page=50')
  })

  test('reason filter is client-side: fetches the full page, filters, then bounds', async () => {
    const rows = [
      NOTIFICATION({ id: '1', reason: 'mention' }),
      NOTIFICATION({ id: '2', reason: 'review_requested' }),
      NOTIFICATION({ id: '3', reason: 'mention' }),
      NOTIFICATION({ id: '4', reason: 'mention' }),
    ]
    const { run, calls } = fakeGh(result({ stdout: JSON.stringify(rows) }))
    const items = await listNotifications(CFG, { reason: 'Mention', limit: 2 }, run)
    expect(calls[0]!.argv[2]).toBe('notifications?per_page=50')
    expect(items.map((n) => n.id)).toEqual(['1', '3'])
    expect(items.every((n) => n.reason === 'mention')).toBe(true)
  })

  test('a sparse reason walks past page 1 until it has `limit` matches', async () => {
    // Page 1 is a full 50-row page with zero mentions; the match lives on page 2.
    const full = Array.from({ length: 50 }, (_, i) =>
      NOTIFICATION({ id: `p1-${i}`, reason: 'review_requested' }),
    )
    const withMention = [NOTIFICATION({ id: 'hit', reason: 'mention' })]
    const { run, calls } = fakeGh((argv) =>
      result({ stdout: JSON.stringify(argv[2]!.includes('page=2') ? withMention : full) }),
    )
    const items = await listNotifications(CFG, { reason: 'mention', limit: 1 }, run)
    expect(calls.map((c) => c.argv[2])).toEqual(['notifications?per_page=50', 'notifications?per_page=50&page=2'])
    expect(items.map((n) => n.id)).toEqual(['hit'])
  })

  test('pagination is bounded by the page cap on an all-non-matching inbox', async () => {
    const full = Array.from({ length: 50 }, (_, i) =>
      NOTIFICATION({ id: `x-${i}`, reason: 'review_requested' }),
    )
    const { run, calls } = fakeGh(result({ stdout: JSON.stringify(full) }))
    const items = await listNotifications(CFG, { reason: 'mention', limit: 5 }, run)
    expect(items).toEqual([])
    expect(calls).toHaveLength(10) // NOTIFICATIONS_PAGE_CAP
  })

  test('GHE host rides --hostname', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await listNotifications({ ...CFG, host: 'ghe.corp.io' }, {}, run)
    expect(calls[0]!.argv).toEqual(['gh', 'api', '--hostname', 'ghe.corp.io', 'notifications?per_page=30'])
  })

  test('auth failure maps through to github_auth', async () => {
    const { run } = fakeGh(result({ exitCode: 1, stderr: 'HTTP 401: Bad credentials\n' }))
    const err = await errorFrom(listNotifications(CFG, {}, run))
    expect(err.code).toBe('github_auth')
  })
})

describe('releases', () => {
  test('explicit repo becomes a literal REST path', async () => {
    const raw = [
      {
        tag_name: 'v2.96.0',
        name: 'GitHub CLI 2.96.0',
        draft: false,
        prerelease: false,
        published_at: '2026-07-02T21:31:04Z',
        html_url: 'https://github.com/cli/cli/releases/tag/v2.96.0',
      },
    ]
    const { run, calls } = fakeGh(result({ stdout: JSON.stringify(raw) }))
    const items = await listReleases(CFG, { repo: 'cli/cli', limit: 5 }, run)
    expect(calls[0]!.argv).toEqual(['gh', 'api', 'repos/cli/cli/releases?per_page=5'])
    expect(items).toEqual([
      {
        tag: 'v2.96.0',
        name: 'GitHub CLI 2.96.0',
        publishedAt: '2026-07-02T21:31:04Z',
        prerelease: false,
        draft: false,
        url: 'https://github.com/cli/cli/releases/tag/v2.96.0',
      },
    ])
  })

  test('no repo resolvable → {owner}/{repo} placeholders for gh to fill from the cwd', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await listReleases(CFG, {}, run)
    expect(calls[0]!.argv[2]).toBe('repos/{owner}/{repo}/releases?per_page=30')
  })

  test('defaultRepo fills the path; GHE host goes to --hostname, never the path', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await listReleases({ host: 'ghe.corp.io', binaryPath: 'gh', defaultRepo: 'a/b' }, {}, run)
    expect(calls[0]!.argv).toEqual(['gh', 'api', '--hostname', 'ghe.corp.io', 'repos/a/b/releases?per_page=30'])
  })

  test('no-repo failure maps through to github_no_repo', async () => {
    const { run } = fakeGh(result({ exitCode: 1, stderr: 'could not determine base repo: no git remotes\n' }))
    const err = await errorFrom(listReleases(CFG, {}, run))
    expect(err.code).toBe('github_no_repo')
  })
})

describe('search code', () => {
  test('threads filters through, then the query last behind a -- separator', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await searchCode(CFG, 'boundText language:typescript', { owner: 'uptonm', repo: 'uptonm/home', limit: 5 }, run)
    expect(calls[0]!.argv).toEqual([
      'gh',
      'search',
      'code',
      '--owner',
      'uptonm',
      '--repo',
      'uptonm/home',
      '--limit',
      '5',
      '--json',
      'path,repository,url,textMatches',
      '--',
      'boundText language:typescript',
    ])
  })

  test('a flag-shaped query rides behind -- so gh cannot parse it as --web', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await searchCode(CFG, '-w', {}, run)
    const sep = calls[0]!.argv.indexOf('--')
    expect(sep).toBeGreaterThan(-1)
    expect(calls[0]!.argv.slice(sep)).toEqual(['--', '-w'])
    // `-w` never appears ahead of the separator where gh would read it as a flag.
    expect(calls[0]!.argv.slice(0, sep)).not.toContain('-w')
  })

  test('never falls back to defaultRepo — search is global by default', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await searchCode({ ...CFG, defaultRepo: 'a/b' }, 'needle', {}, run)
    expect(calls[0]!.argv).not.toContain('--repo')
    expect(calls[0]!.argv[calls[0]!.argv.indexOf('--limit') + 1]).toBe('30')
  })

  test('rejects an empty query and a malformed --repo', async () => {
    const { run } = fakeGh(result({ stdout: '[]' }))
    expect((await errorFrom(searchCode(CFG, '   ', {}, run))).code).toBe('bad_arg')
    expect((await errorFrom(searchCode(CFG, 'needle', { repo: 'just-a-name' }, run))).code).toBe('bad_arg')
  })

  test('bounds fragments per hit: first 3, each capped', async () => {
    const raw = [
      {
        path: 'pkg/root.go',
        repository: { nameWithOwner: 'cli/cli' },
        url: 'https://github.com/cli/cli/blob/abc/pkg/root.go',
        textMatches: Array.from({ length: 5 }, (_, i) => ({
          fragment: i === 0 ? 'x'.repeat(1000) : `fragment ${i}`,
        })),
      },
    ]
    const { run } = fakeGh(result({ stdout: JSON.stringify(raw) }))
    const items = await searchCode(CFG, 'needle', {}, run)
    expect(items[0]!.repo).toBe('cli/cli')
    expect(items[0]!.path).toBe('pkg/root.go')
    expect(items[0]!.fragments).toHaveLength(3)
    expect(items[0]!.fragments[0]).toHaveLength(300)
    expect(items[0]!.fragments[1]).toBe('fragment 1')
  })

  test('error mapping passes through (auth)', async () => {
    const { run } = fakeGh(result({ exitCode: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }))
    const err = await errorFrom(searchCode(CFG, 'needle', {}, run))
    expect(err.code).toBe('github_auth')
  })
})

describe('summarizeRollup', () => {
  test('CheckRun rows judge conclusion, StatusContext rows judge state', () => {
    const summary = summarizeRollup([
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x/1' },
      { name: 'deploy', status: 'IN_PROGRESS', conclusion: null },
      { context: 'ci/legacy', state: 'ERROR', targetUrl: 'https://x/2' },
      { context: 'ci/wait', state: 'PENDING' },
    ])
    expect(summary).toEqual({
      total: 5,
      failed: 2,
      pending: 2,
      failing: [
        { name: 'test', url: 'https://x/1' },
        { name: 'ci/legacy', url: 'https://x/2' },
      ],
    })
  })

  test('caps the failing list at 10 but keeps the true failed count', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      name: `check-${i}`,
      status: 'COMPLETED',
      conclusion: 'FAILURE',
    }))
    const summary = summarizeRollup(items)
    expect(summary.failed).toBe(15)
    expect(summary.failing).toHaveLength(10)
  })

  test('empty rollup → all zeroes', () => {
    expect(summarizeRollup([])).toEqual({ total: 0, failed: 0, pending: 0, failing: [] })
  })
})

describe('repoFromUrl', () => {
  test('extracts owner/name from PR and run URLs', () => {
    expect(repoFromUrl('https://github.com/cli/cli/pull/1234')).toBe('cli/cli')
    expect(repoFromUrl('https://github.com/uptonm/home/actions/runs/99')).toBe('uptonm/home')
    expect(repoFromUrl('')).toBeNull()
  })
})

describe('summary', () => {
  const MINE = JSON.stringify([
    {
      number: 7,
      title: 'add briefing layer',
      isDraft: false,
      headRefName: 'codex/briefings',
      url: 'https://github.com/uptonm/home/pull/7',
      updatedAt: '2026-07-17T01:00:00Z',
      statusCheckRollup: [
        { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x/job' },
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      ],
    },
  ])
  const REVIEW = JSON.stringify([
    {
      number: 12,
      title: 'someone else needs eyes',
      author: { login: 'colleague' },
      isDraft: false,
      url: 'https://github.com/uptonm/atlas/pull/12',
      updatedAt: '2026-07-16T09:00:00Z',
    },
  ])
  const RUNS = JSON.stringify([
    {
      databaseId: 555,
      number: 41,
      workflowName: 'CI',
      displayTitle: 'add briefing layer',
      headBranch: 'codex/briefings',
      event: 'push',
      status: 'completed',
      conclusion: 'failure',
      createdAt: '2026-07-17T00:00:00Z',
      updatedAt: '2026-07-17T00:05:00Z',
      url: 'https://github.com/uptonm/home/actions/runs/555',
    },
  ])

  function dispatchByArgv(argv: string[]): ProcessResult {
    if (argv.includes('--author')) return result({ stdout: MINE })
    if (argv.includes('--search')) return result({ stdout: REVIEW })
    return result({ stdout: RUNS })
  }

  test('composes from exactly three gh calls with the right filters', async () => {
    const { run, calls } = fakeGh(dispatchByArgv)
    await getSummary({ ...CFG, defaultRepo: 'uptonm/home' }, undefined, run)
    expect(calls).toHaveLength(3)
    const [mine, review, runs] = calls.map((c) => c.argv)
    expect(mine!.slice(0, 3)).toEqual(['gh', 'pr', 'list'])
    expect(mine).toContain('--author')
    expect(mine![mine!.indexOf('--author') + 1]).toBe('@me')
    expect(mine![mine!.indexOf('--repo') + 1]).toBe('uptonm/home')
    expect(mine![mine!.indexOf('--json') + 1]).toContain('statusCheckRollup')
    expect(review![review!.indexOf('--search') + 1]).toBe('review-requested:@me')
    expect(runs!.slice(0, 3)).toEqual(['gh', 'run', 'list'])
    expect(runs![runs!.indexOf('--status') + 1]).toBe('failure')
  })

  test('every section is bounded by an explicit --limit', async () => {
    const { run, calls } = fakeGh(dispatchByArgv)
    await getSummary(CFG, undefined, run)
    for (const { argv } of calls) {
      const limit = Number(argv[argv.indexOf('--limit') + 1])
      expect(limit).toBeGreaterThan(0)
      expect(limit).toBeLessThanOrEqual(20)
    }
  })

  test('each item carries the identifiers for the next command: pr number, run id, repo', async () => {
    const { run } = fakeGh(dispatchByArgv)
    const briefing = await getSummary(CFG, 'uptonm/home', run)
    expect(briefing.myOpenPrs).toEqual([
      {
        number: 7,
        title: 'add briefing layer',
        isDraft: false,
        headRef: 'codex/briefings',
        url: 'https://github.com/uptonm/home/pull/7',
        repo: 'uptonm/home',
        updatedAt: '2026-07-17T01:00:00Z',
        checks: { total: 2, failed: 1, pending: 0, failing: [{ name: 'test', url: 'https://x/job' }] },
      },
    ])
    expect(briefing.reviewRequested).toEqual([
      {
        number: 12,
        title: 'someone else needs eyes',
        author: 'colleague',
        isDraft: false,
        url: 'https://github.com/uptonm/atlas/pull/12',
        repo: 'uptonm/atlas',
        updatedAt: '2026-07-16T09:00:00Z',
      },
    ])
    expect(briefing.failedRuns).toHaveLength(1)
    expect(briefing.failedRuns[0]!.id).toBe(555)
    expect(briefing.failedRuns[0]!.repo).toBe('uptonm/home')
    expect(briefing.failedRuns[0]!.conclusion).toBe('failure')
  })

  test('empty everywhere → empty sections, not errors', async () => {
    const { run } = fakeGh(result({ stdout: '[]' }))
    const briefing = await getSummary(CFG, undefined, run)
    expect(briefing).toEqual({ myOpenPrs: [], reviewRequested: [], failedRuns: [] })
  })

  test('a bad --repo rejects before any gh call', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    const err = await errorFrom(getSummary(CFG, 'not a repo', run))
    expect(err).toBeInstanceOf(UserError)
    expect(err.code).toBe('bad_arg')
    expect(calls).toHaveLength(0)
  })

  test('error mapping passes through from any leg (no repo resolvable)', async () => {
    const { run } = fakeGh(result({ exitCode: 1, stderr: 'failed to run git: fatal: not a git repository\n' }))
    const err = await errorFrom(getSummary(CFG, undefined, run))
    expect(err.code).toBe('github_no_repo')
  })
})
