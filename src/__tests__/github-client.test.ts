import { describe, expect, test } from 'bun:test'
import { HomeError, SystemError, UserError } from '../core/errors'
import type { ProcessOptions, ProcessResult } from '../core/process'
import {
  checkAuth,
  extractStackLinks,
  getIssue,
  getPr,
  getPrChecks,
  getPrDiff,
  getRepo,
  getRun,
  listIssues,
  listPrs,
  listRuns,
  normalizeIssueDetail,
  normalizePrDetail,
  normalizeRunDetail,
  parseAuthStatus,
  parseIssueRef,
  parsePrRef,
  readGithubConfig,
  resolveRepoFlag,
  summarizeChecks,
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

describe('readGithubConfig', () => {
  test('applies defaults for host and binaryPath', () => {
    expect(readGithubConfig({})).toEqual({ host: 'github.com', binaryPath: 'gh' })
  })

  test('keeps explicit values and a valid defaultRepo', () => {
    expect(readGithubConfig({ host: 'ghe.corp.io', binaryPath: '/opt/gh', defaultRepo: 'uptonm/home' })).toEqual({
      host: 'ghe.corp.io',
      binaryPath: '/opt/gh',
      defaultRepo: 'uptonm/home',
    })
  })

  test('rejects a malformed defaultRepo', () => {
    expect(() => readGithubConfig({ defaultRepo: 'just-a-name' })).toThrow(UserError)
  })
})

describe('resolveRepoFlag', () => {
  test('explicit arg beats defaultRepo', () => {
    expect(resolveRepoFlag({ ...CFG, defaultRepo: 'a/b' }, 'c/d')).toBe('c/d')
  })

  test('falls back to defaultRepo, then null (cwd inference)', () => {
    expect(resolveRepoFlag({ ...CFG, defaultRepo: 'a/b' }, undefined)).toBe('a/b')
    expect(resolveRepoFlag(CFG, undefined)).toBeNull()
  })

  test('prefixes a non-github.com host', () => {
    expect(resolveRepoFlag({ ...CFG, host: 'ghe.corp.io' }, 'a/b')).toBe('ghe.corp.io/a/b')
  })

  test('leaves an already host-qualified repo alone', () => {
    expect(resolveRepoFlag({ ...CFG, host: 'ghe.corp.io' }, 'other.host/a/b')).toBe('other.host/a/b')
  })

  test('rejects garbage', () => {
    expect(() => resolveRepoFlag(CFG, 'not a repo')).toThrow(UserError)
  })
})

describe('PR/issue ref parsing', () => {
  test('accepts bare and hash-prefixed numbers', () => {
    expect(parsePrRef('42')).toEqual({ selector: '42', isUrl: false })
    expect(parsePrRef('#42')).toEqual({ selector: '42', isUrl: false })
  })

  test('accepts a full PR URL', () => {
    const url = 'https://github.com/cli/cli/pull/1234'
    expect(parsePrRef(url)).toEqual({ selector: url, isUrl: true })
  })

  test('issue refs use /issues/ URLs, not /pull/', () => {
    const url = 'https://github.com/cli/cli/issues/9'
    expect(parseIssueRef(url)).toEqual({ selector: url, isUrl: true })
    expect(() => parseIssueRef('https://github.com/cli/cli/pull/9')).toThrow(UserError)
  })

  test('rejects branch names and garbage', () => {
    expect(() => parsePrRef('my-branch')).toThrow(UserError)
    expect(() => parsePrRef('')).toThrow(UserError)
  })
})

describe('arg construction', () => {
  test('prs list threads filters through as discrete argv elements', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await listPrs(CFG, { repo: 'a/b', state: 'merged', author: '$(whoami); rm -rf /', limit: 5 }, run)
    expect(calls[0]!.argv).toEqual([
      'gh',
      'pr',
      'list',
      '--repo',
      'a/b',
      '--state',
      'merged',
      '--author',
      '$(whoami); rm -rf /',
      '--limit',
      '5',
      '--json',
      'number,title,state,isDraft,author,headRefName,baseRefName,url,createdAt,updatedAt',
    ])
  })

  test('omits --repo entirely when nothing resolves, so gh infers from cwd', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await listPrs(CFG, { limit: 30 }, run)
    expect(calls[0]!.argv).not.toContain('--repo')
  })

  test('prs get by number sends the number plus --repo from defaultRepo', async () => {
    const { run, calls } = fakeGh(result({ stdout: '{}' }))
    await getPr({ ...CFG, defaultRepo: 'a/b' }, '#42', undefined, run)
    expect(calls[0]!.argv.slice(0, 6)).toEqual(['gh', 'pr', 'view', '42', '--repo', 'a/b'])
  })

  test('prs get by URL passes the URL through and drops --repo', async () => {
    const url = 'https://github.com/cli/cli/pull/1234'
    const { run, calls } = fakeGh(result({ stdout: '{}' }))
    await getPr({ ...CFG, defaultRepo: 'a/b' }, url, 'c/d', run)
    expect(calls[0]!.argv).toContain(url)
    expect(calls[0]!.argv).not.toContain('--repo')
  })

  test('uses the configured binaryPath as argv[0]', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await listIssues({ ...CFG, binaryPath: '/opt/homebrew/bin/gh' }, {}, run)
    expect(calls[0]!.argv[0]).toBe('/opt/homebrew/bin/gh')
  })

  test('runs list applies branch/status filters and default limit', async () => {
    const { run, calls } = fakeGh(result({ stdout: '[]' }))
    await listRuns(CFG, { branch: 'main', status: 'failure' }, run)
    const argv = calls[0]!.argv
    expect(argv.slice(0, 3)).toEqual(['gh', 'run', 'list'])
    expect(argv).toContain('--branch')
    expect(argv).toContain('--status')
    expect(argv[argv.indexOf('--limit') + 1]).toBe('30')
  })

  test('runs get requires a numeric id', async () => {
    const { run } = fakeGh(result({ stdout: '{}' }))
    const err = await errorFrom(getRun(CFG, 'abc', undefined, run))
    expect(err.code).toBe('bad_arg')
  })

  test('repos get passes the repo as a positional, host-prefixed on GHE', async () => {
    const { run, calls } = fakeGh(result({ stdout: '{}' }))
    await getRepo({ ...CFG, host: 'ghe.corp.io' }, 'a/b', run)
    expect(calls[0]!.argv.slice(0, 4)).toEqual(['gh', 'repo', 'view', 'ghe.corp.io/a/b'])
  })
})

describe('error mapping', () => {
  test('gh binary missing → github_gh_missing', async () => {
    const run: GhRunner = async () => {
      throw new SystemError('binary not found: gh', 'process_not_found')
    }
    const err = await errorFrom(listPrs(CFG, {}, run))
    expect(err.code).toBe('github_gh_missing')
  })

  test('auth failure text → github_auth', async () => {
    const { run } = fakeGh(
      result({ exitCode: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }),
    )
    const err = await errorFrom(listPrs(CFG, {}, run))
    expect(err.code).toBe('github_auth')
  })

  test('HTTP 401 → github_auth', async () => {
    const { run } = fakeGh(result({ exitCode: 1, stderr: 'HTTP 401: Bad credentials (https://api.github.com/graphql)\n' }))
    const err = await errorFrom(getRepo(CFG, 'a/b', run))
    expect(err.code).toBe('github_auth')
  })

  test('no repo resolvable → github_no_repo', async () => {
    const { run } = fakeGh(
      result({ exitCode: 1, stderr: 'failed to run git: fatal: not a git repository (or any parent up to mount point /)\n' }),
    )
    const err = await errorFrom(listPrs(CFG, {}, run))
    expect(err.code).toBe('github_no_repo')
  })

  test('anything else → github_api_failed, with gh text in the message', async () => {
    const { run } = fakeGh(
      result({ exitCode: 1, stderr: "GraphQL: Could not resolve to a Repository with the name 'a/b'. (repository)\n" }),
    )
    const err = await errorFrom(listPrs(CFG, { repo: 'a/b' }, run))
    expect(err.code).toBe('github_api_failed')
    expect(err.message).toContain('Could not resolve to a Repository')
  })

  test('timeout → github_api_failed mentioning the timeout', async () => {
    const { run } = fakeGh(result({ exitCode: null, signal: 'SIGKILL', timedOut: true }))
    const err = await errorFrom(listPrs(CFG, {}, run))
    expect(err.code).toBe('github_api_failed')
    expect(err.message).toContain('timed out')
  })

  test('unparseable stdout on success → github_api_failed', async () => {
    const { run } = fakeGh(result({ stdout: 'flagrant nonsense' }))
    const err = await errorFrom(listPrs(CFG, {}, run))
    expect(err.code).toBe('github_api_failed')
  })
})

describe('checks summarization', () => {
  test('counts buckets and names the failures', () => {
    const summary = summarizeChecks([
      { name: 'build', bucket: 'pass' },
      { name: 'lint', bucket: 'pass' },
      { name: 'test', bucket: 'fail', workflow: 'CI', link: 'https://x/1' },
      { name: 'deploy', bucket: 'pending' },
      { name: 'docs', bucket: 'skipping' },
      { name: 'old', bucket: 'cancel' },
    ])
    expect(summary).toEqual({
      total: 6,
      pass: 2,
      fail: 1,
      pending: 1,
      skipped: 1,
      cancelled: 1,
      failing: [{ name: 'test', workflow: 'CI', link: 'https://x/1' }],
    })
  })

  test('accepts gh exit code 1/8 as long as the JSON is present', async () => {
    const { run } = fakeGh(result({ exitCode: 8, stdout: '[{"name":"build","bucket":"pending"}]' }))
    const summary = await getPrChecks(CFG, '42', 'a/b', run)
    expect(summary.pending).toBe(1)
  })

  test('"no checks reported" on stderr → empty summary, not an error', async () => {
    const { run } = fakeGh(result({ exitCode: 1, stderr: "no checks reported on the 'main' branch\n" }))
    const summary = await getPrChecks(CFG, '42', 'a/b', run)
    expect(summary.total).toBe(0)
  })

  test('exit 1 without JSON and without the no-checks marker still maps errors', async () => {
    const { run } = fakeGh(result({ exitCode: 1, stderr: 'HTTP 401: Bad credentials\n' }))
    const err = await errorFrom(getPrChecks(CFG, '42', 'a/b', run))
    expect(err.code).toBe('github_auth')
  })
})

describe('diff', () => {
  test('returns the patch and flags truncation from the stream cap', async () => {
    const { run } = fakeGh(result({ stdout: 'diff --git a/x b/x\n+hi\n', stdoutTruncated: true }))
    const diff = await getPrDiff(CFG, '42', { repo: 'a/b' }, run)
    expect(diff.patch).toContain('diff --git')
    expect(diff.truncated).toBe(true)
  })

  test('--name-only parses file names and drops a possibly-partial last line when truncated', async () => {
    const { run, calls } = fakeGh(result({ stdout: 'src/a.ts\nsrc/b.ts\nsrc/partia', stdoutTruncated: true }))
    const diff = await getPrDiff(CFG, '42', { repo: 'a/b', nameOnly: true }, run)
    expect(calls[0]!.argv).toContain('--name-only')
    expect(diff.files).toEqual(['src/a.ts', 'src/b.ts'])
    expect(diff.truncated).toBe(true)
  })
})

describe('normalization', () => {
  test('PR detail: reviews flattened, labels named, body bounded, stack links pulled from the body', () => {
    const body = [
      'Part of a stack:',
      '- https://github.com/a/b/pull/1',
      '- https://github.com/a/b/pull/2 (this PR)',
      '- https://github.com/a/b/pull/3',
    ].join('\n')
    const detail = normalizePrDetail({
      number: 2,
      title: 'middle of stack',
      state: 'OPEN',
      author: { login: 'uptonm' },
      headRefName: 'feat-2',
      baseRefName: 'feat-1',
      url: 'https://github.com/a/b/pull/2',
      body,
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      latestReviews: [{ author: { login: 'rev' }, state: 'APPROVED', submittedAt: '2026-07-01T00:00:00Z' }],
      labels: [{ name: 'bug' }],
    })
    expect(detail.author).toBe('uptonm')
    expect(detail.reviews).toEqual([{ author: 'rev', state: 'APPROVED', submittedAt: '2026-07-01T00:00:00Z' }])
    expect(detail.labels).toEqual(['bug'])
    expect(detail.stackLinks).toEqual(['https://github.com/a/b/pull/1', 'https://github.com/a/b/pull/3'])
    expect(detail.bodyTruncated).toBe(false)
  })

  test('extractStackLinks dedupes and excludes the PR itself', () => {
    const body = 'see https://github.com/a/b/pull/7 and again https://github.com/a/b/pull/7'
    expect(extractStackLinks(body, 'https://github.com/a/b/pull/2')).toEqual(['https://github.com/a/b/pull/7'])
    expect(extractStackLinks(null)).toEqual([])
  })

  test('run detail computes durations and strips job steps', () => {
    const detail = normalizeRunDetail({
      databaseId: 99,
      workflowName: 'CI',
      status: 'completed',
      conclusion: 'success',
      startedAt: '2026-07-17T00:00:00Z',
      updatedAt: '2026-07-17T00:02:30Z',
      jobs: [
        {
          name: 'test',
          status: 'completed',
          conclusion: 'success',
          startedAt: '2026-07-17T00:00:10Z',
          completedAt: '2026-07-17T00:01:10Z',
          url: 'https://x/job',
        },
      ],
    })
    expect(detail.id).toBe(99)
    expect(detail.durationSeconds).toBe(150)
    expect(detail.jobs[0]!.durationSeconds).toBe(60)
    expect(detail.jobs[0]).not.toHaveProperty('steps')
  })

  test('issue detail bounds comments to the newest 20 and caps comment bodies', () => {
    const comments = Array.from({ length: 25 }, (_, i) => ({
      author: { login: `user${i}` },
      body: i === 24 ? 'x'.repeat(5000) : `comment ${i}`,
      createdAt: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    }))
    const detail = normalizeIssueDetail({ number: 1, title: 't', comments })
    expect(detail.totalComments).toBe(25)
    expect(detail.comments).toHaveLength(20)
    expect(detail.commentsTruncated).toBe(true)
    expect(detail.comments[0]!.author).toBe('user5')
    const last = detail.comments.at(-1)!
    expect(last.body).toHaveLength(4000)
    expect(last.bodyTruncated).toBe(true)
  })

  test('issue list normalizes author/labels/assignees', async () => {
    const raw = JSON.stringify([
      {
        number: 3,
        title: 'boom',
        state: 'OPEN',
        author: { login: 'someone' },
        labels: [{ name: 'bug' }],
        assignees: [{ login: 'uptonm' }],
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-02T00:00:00Z',
        url: 'https://github.com/a/b/issues/3',
      },
    ])
    const { run } = fakeGh(result({ stdout: raw }))
    const issues = await listIssues(CFG, { repo: 'a/b' }, run)
    expect(issues[0]).toEqual({
      number: 3,
      title: 'boom',
      state: 'OPEN',
      author: 'someone',
      labels: ['bug'],
      assignees: ['uptonm'],
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-02T00:00:00Z',
      url: 'https://github.com/a/b/issues/3',
    })
  })

  test('issue get accepts an issue URL', async () => {
    const { run, calls } = fakeGh(result({ stdout: '{"number":9}' }))
    const detail = await getIssue(CFG, 'https://github.com/a/b/issues/9', undefined, run)
    expect(detail.number).toBe(9)
    expect(calls[0]!.argv).toContain('https://github.com/a/b/issues/9')
  })
})

describe('auth status', () => {
  const SAMPLE = {
    hosts: {
      'github.com': [
        { state: 'success', active: true, host: 'github.com', login: 'uptonm', gitProtocol: 'ssh' },
        { state: 'error', active: false, host: 'github.com', login: 'old-account' },
      ],
    },
  }

  test('parseAuthStatus picks the active account', () => {
    expect(parseAuthStatus(SAMPLE, 'github.com')).toEqual({ authenticated: true, login: 'uptonm' })
  })

  test('parseAuthStatus: unknown host → unauthenticated', () => {
    expect(parseAuthStatus(SAMPLE, 'ghe.corp.io')).toEqual({ authenticated: false, login: null })
    expect(parseAuthStatus({}, 'github.com')).toEqual({ authenticated: false, login: null })
  })

  test('parseAuthStatus: active account in a bad state is not authenticated', () => {
    const raw = { hosts: { 'github.com': [{ state: 'error', active: true, login: 'uptonm' }] } }
    expect(parseAuthStatus(raw, 'github.com')).toEqual({ authenticated: false, login: 'uptonm' })
  })

  test('checkAuth issues exactly one bounded gh invocation with --hostname', async () => {
    const { run, calls } = fakeGh(result({ stdout: JSON.stringify(SAMPLE) }))
    const auth = await checkAuth(CFG, run)
    expect(auth).toEqual({ authenticated: true, login: 'uptonm' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.argv).toEqual(['gh', 'auth', 'status', '--hostname', 'github.com', '--active', '--json', 'hosts'])
    expect(calls[0]!.opts?.timeoutMs).toBe(10_000)
  })

  test('checkAuth: old gh without --json support → clear github_api_failed', async () => {
    const { run } = fakeGh(result({ exitCode: 1, stderr: 'unknown flag: --json\n' }))
    const err = await errorFrom(checkAuth(CFG, run))
    expect(err.code).toBe('github_api_failed')
    expect(err.message).toContain('upgrade')
  })

  test('checkAuth: gh missing → github_gh_missing', async () => {
    const run: GhRunner = async () => {
      throw new SystemError('binary not found: gh', 'process_not_found')
    }
    const err = await errorFrom(checkAuth(CFG, run))
    expect(err.code).toBe('github_gh_missing')
  })
})
