import { SystemError, UserError } from '../../core/errors'
import { runProcess, type ProcessResult } from '../../core/process'
import type { ModuleConfig } from '../../core/types'

export type GhRunner = typeof runProcess

export const DEFAULT_LIMIT = 30
export const MAX_LIMIT = 100

const GH_TIMEOUT_MS = 30_000
const AUTH_TIMEOUT_MS = 10_000
const DIFF_MAX_BYTES = 262_144
const BODY_MAX_CHARS = 20_000
const COMMENT_MAX_CHARS = 4_000
const MAX_COMMENTS = 20

export interface GithubConfig {
  host: string
  binaryPath: string
  defaultRepo?: string
}

/** owner/name, optionally prefixed with a host segment (host/owner/name). */
const REPO_RE = /^(?:[\w.-]+\/)?[\w.-]+\/[\w.-]+$/

export function readGithubConfig(cfg: ModuleConfig): GithubConfig {
  const host = String(cfg.host ?? '').trim() || 'github.com'
  const binaryPath = String(cfg.binaryPath ?? '').trim() || 'gh'
  const defaultRepo = String(cfg.defaultRepo ?? '').trim()
  if (defaultRepo && !REPO_RE.test(defaultRepo)) {
    throw new UserError(
      `defaultRepo must be owner/name — got ${JSON.stringify(defaultRepo)}; fix it with \`home github configure\``,
      'github_bad_config',
    )
  }
  return { host, binaryPath, ...(defaultRepo ? { defaultRepo } : {}) }
}

/**
 * Resolve the value for gh's `--repo` flag: explicit arg wins, then the
 * configured defaultRepo, then null — meaning omit the flag and let gh infer
 * the repo from the cwd's git remotes. A non-github.com host is prefixed so
 * gh targets it without needing GH_HOST in the environment.
 */
export function resolveRepoFlag(cfg: GithubConfig, repoArg: string | undefined): string | null {
  const repo = repoArg?.trim() || cfg.defaultRepo
  if (!repo) return null
  if (!REPO_RE.test(repo)) {
    throw new UserError(`--repo must be owner/name — got ${JSON.stringify(repo)}`, 'bad_arg')
  }
  const alreadyHasHost = repo.split('/').length === 3
  if (alreadyHasHost || cfg.host === 'github.com') return repo
  return `${cfg.host}/${repo}`
}

function repoFlagArgs(cfg: GithubConfig, repoArg: string | undefined): string[] {
  const value = resolveRepoFlag(cfg, repoArg)
  return value ? ['--repo', value] : []
}

export interface ItemRef {
  /** What gh gets as the selector: a bare number or the full URL. */
  selector: string
  isUrl: boolean
}

function parseItemRef(ref: string, urlSegment: 'pull' | 'issues', noun: string): ItemRef {
  const trimmed = ref.trim()
  if (new RegExp(`^https://[^\\s/]+/[^\\s/]+/[^\\s/]+/${urlSegment}/\\d+([/?#]\\S*)?$`).test(trimmed)) {
    return { selector: trimmed, isUrl: true }
  }
  const bare = trimmed.replace(/^#/, '')
  if (/^\d+$/.test(bare)) return { selector: bare, isUrl: false }
  throw new UserError(`expected a ${noun} number or URL — got ${JSON.stringify(ref)}`, 'bad_arg')
}

export function parsePrRef(ref: string): ItemRef {
  return parseItemRef(ref, 'pull', 'PR')
}

export function parseIssueRef(ref: string): ItemRef {
  return parseItemRef(ref, 'issues', 'issue')
}

/** A URL selector already names the repo — sending --repo too would fight it. */
function selectorArgs(cfg: GithubConfig, ref: ItemRef, repoArg: string | undefined): string[] {
  return [ref.selector, ...(ref.isUrl ? [] : repoFlagArgs(cfg, repoArg))]
}

const AUTH_PATTERNS = [
  /not logged in/i,
  /gh auth login/i,
  /authentication token/i,
  /HTTP 401/i,
  /bad credentials/i,
  /must be authenticated/i,
]

const NO_REPO_PATTERNS = [
  /not a git repository/i,
  /no git remotes/i,
  /could not determine base repo/i,
  /unable to determine base repository/i,
]

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}

/** Map a nonzero gh exit to a stable error code; gh's own text stays in the message, labeled. */
export function ghFailure(args: readonly string[], result: ProcessResult): SystemError | UserError {
  const detail = firstLine(result.stderr) || firstLine(result.stdout) || `exit ${result.exitCode}`
  const combined = `${result.stderr}\n${result.stdout}`
  if (NO_REPO_PATTERNS.some((p) => p.test(combined))) {
    return new UserError(
      `no repository resolvable — pass --repo owner/name, set defaultRepo, or run inside a checkout (gh: ${detail})`,
      'github_no_repo',
    )
  }
  if (AUTH_PATTERNS.some((p) => p.test(combined))) {
    return new UserError(`gh is not authenticated — run \`gh auth login\` (gh: ${detail})`, 'github_auth')
  }
  const what = args.slice(0, 2).join(' ')
  return new SystemError(`gh ${what} failed (exit ${result.exitCode}): ${detail}`, 'github_api_failed')
}

interface ExecOptions {
  timeoutMs?: number
  maxOutputBytes?: number
  /** Exit codes that carry usable output (e.g. `gh pr checks` exits 1/8 for fail/pending). */
  okExitCodes?: readonly number[]
}

export async function execGh(
  cfg: GithubConfig,
  args: readonly string[],
  opts: ExecOptions = {},
  run: GhRunner = runProcess,
): Promise<ProcessResult> {
  const timeoutMs = opts.timeoutMs ?? GH_TIMEOUT_MS
  let result: ProcessResult
  try {
    result = await run([cfg.binaryPath, ...args], {
      timeoutMs,
      ...(opts.maxOutputBytes === undefined ? {} : { maxOutputBytes: opts.maxOutputBytes }),
    })
  } catch (err) {
    if (err instanceof SystemError && err.code === 'process_not_found') {
      throw new SystemError(
        `gh binary not found (${JSON.stringify(cfg.binaryPath)}) — install GitHub CLI (https://cli.github.com) or set binaryPath via \`home github configure\``,
        'github_gh_missing',
      )
    }
    throw err
  }
  if (result.timedOut) {
    throw new SystemError(`gh ${args.slice(0, 2).join(' ')} timed out after ${timeoutMs}ms`, 'github_api_failed')
  }
  const okExitCodes = opts.okExitCodes ?? [0]
  if (!okExitCodes.includes(result.exitCode ?? -1)) throw ghFailure(args, result)
  return result
}

function parseGhJson<T>(what: string, result: ProcessResult): T {
  if (result.stdoutTruncated) {
    throw new SystemError(`gh ${what} output exceeded the size cap — response unusable`, 'github_api_failed')
  }
  try {
    return JSON.parse(result.stdout) as T
  } catch {
    throw new SystemError(`gh ${what} returned unparseable JSON`, 'github_api_failed')
  }
}

interface BoundedText {
  text: string
  truncated: boolean
}

function boundText(text: string | null | undefined, maxChars: number): BoundedText {
  const full = text ?? ''
  if (full.length <= maxChars) return { text: full, truncated: false }
  return { text: full.slice(0, maxChars), truncated: true }
}

// ---------------------------------------------------------------------------
// repos

const REPO_FIELDS =
  'name,nameWithOwner,owner,description,defaultBranchRef,visibility,isPrivate,isArchived,isFork,url,pushedAt'

interface RawRepo {
  name?: string
  nameWithOwner?: string
  description?: string | null
  defaultBranchRef?: { name?: string } | null
  visibility?: string
  isPrivate?: boolean
  isArchived?: boolean
  isFork?: boolean
  url?: string
  pushedAt?: string
}

export interface RepoInfo {
  name: string
  nameWithOwner: string
  description: string | null
  defaultBranch: string | null
  visibility: string
  isPrivate: boolean
  isArchived: boolean
  isFork: boolean
  url: string
  pushedAt: string | null
}

export function normalizeRepo(raw: RawRepo): RepoInfo {
  return {
    name: raw.name ?? '',
    nameWithOwner: raw.nameWithOwner ?? '',
    description: raw.description ?? null,
    defaultBranch: raw.defaultBranchRef?.name ?? null,
    visibility: (raw.visibility ?? '').toLowerCase(),
    isPrivate: raw.isPrivate ?? false,
    isArchived: raw.isArchived ?? false,
    isFork: raw.isFork ?? false,
    url: raw.url ?? '',
    pushedAt: raw.pushedAt ?? null,
  }
}

export async function getRepo(
  cfg: GithubConfig,
  repoArg: string | undefined,
  run: GhRunner = runProcess,
): Promise<RepoInfo> {
  const positional = resolveRepoFlag(cfg, repoArg)
  const args = ['repo', 'view', ...(positional ? [positional] : []), '--json', REPO_FIELDS]
  const result = await execGh(cfg, args, {}, run)
  return normalizeRepo(parseGhJson<RawRepo>('repo view', result))
}

// ---------------------------------------------------------------------------
// pull requests

interface RawActor {
  login?: string
}

interface RawLabel {
  name?: string
}

const PR_LIST_FIELDS = 'number,title,state,isDraft,author,headRefName,baseRefName,url,createdAt,updatedAt'
const PR_DETAIL_FIELDS = `${PR_LIST_FIELDS},body,mergeable,mergeStateStatus,reviewDecision,latestReviews,additions,deletions,changedFiles,labels,mergedAt,closedAt`

interface RawPr {
  number?: number
  title?: string
  state?: string
  isDraft?: boolean
  author?: RawActor | null
  headRefName?: string
  baseRefName?: string
  url?: string
  createdAt?: string
  updatedAt?: string
  body?: string | null
  mergeable?: string
  mergeStateStatus?: string
  reviewDecision?: string
  latestReviews?: { author?: RawActor | null; state?: string; submittedAt?: string }[]
  additions?: number
  deletions?: number
  changedFiles?: number
  labels?: RawLabel[]
  mergedAt?: string | null
  closedAt?: string | null
}

export interface PrSummary {
  number: number
  title: string
  state: string
  isDraft: boolean
  author: string | null
  headRef: string
  baseRef: string
  url: string
  createdAt: string | null
  updatedAt: string | null
}

export function normalizePrSummary(raw: RawPr): PrSummary {
  return {
    number: raw.number ?? 0,
    title: raw.title ?? '',
    state: raw.state ?? '',
    isDraft: raw.isDraft ?? false,
    author: raw.author?.login ?? null,
    headRef: raw.headRefName ?? '',
    baseRef: raw.baseRefName ?? '',
    url: raw.url ?? '',
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  }
}

export interface PrDetail extends PrSummary {
  body: string
  bodyTruncated: boolean
  mergeable: string
  mergeStateStatus: string
  reviewDecision: string
  reviews: { author: string | null; state: string; submittedAt: string | null }[]
  additions: number
  deletions: number
  changedFiles: number
  labels: string[]
  mergedAt: string | null
  closedAt: string | null
  /** PR URLs referenced in the body — stack tools (graphite etc.) link siblings there. */
  stackLinks: string[]
}

/**
 * Pull sibling-PR links out of a PR body. Stacking tools render the stack as a
 * list of PR URLs in the description, so any /pull/N URL other than the PR's
 * own is a candidate stack link.
 */
export function extractStackLinks(body: string | null | undefined, selfUrl?: string): string[] {
  if (!body) return []
  const matches = body.match(/https:\/\/[^\s()<>[\]"']+\/pull\/\d+/g) ?? []
  return [...new Set(matches)].filter((url) => url !== selfUrl)
}

export function normalizePrDetail(raw: RawPr): PrDetail {
  const body = boundText(raw.body, BODY_MAX_CHARS)
  return {
    ...normalizePrSummary(raw),
    body: body.text,
    bodyTruncated: body.truncated,
    mergeable: raw.mergeable ?? '',
    mergeStateStatus: raw.mergeStateStatus ?? '',
    reviewDecision: raw.reviewDecision ?? '',
    reviews: (raw.latestReviews ?? []).map((r) => ({
      author: r.author?.login ?? null,
      state: r.state ?? '',
      submittedAt: r.submittedAt ?? null,
    })),
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? 0,
    labels: (raw.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
    mergedAt: raw.mergedAt ?? null,
    closedAt: raw.closedAt ?? null,
    stackLinks: extractStackLinks(raw.body, raw.url),
  }
}

export interface PrListOptions {
  repo?: string
  state?: string
  author?: string
  limit?: number
}

export async function listPrs(
  cfg: GithubConfig,
  opts: PrListOptions,
  run: GhRunner = runProcess,
): Promise<PrSummary[]> {
  const args = [
    'pr',
    'list',
    ...repoFlagArgs(cfg, opts.repo),
    ...(opts.state ? ['--state', opts.state] : []),
    ...(opts.author ? ['--author', opts.author] : []),
    '--limit',
    String(opts.limit ?? DEFAULT_LIMIT),
    '--json',
    PR_LIST_FIELDS,
  ]
  const result = await execGh(cfg, args, {}, run)
  return parseGhJson<RawPr[]>('pr list', result).map(normalizePrSummary)
}

export async function getPr(
  cfg: GithubConfig,
  ref: string,
  repoArg: string | undefined,
  run: GhRunner = runProcess,
): Promise<PrDetail> {
  const args = ['pr', 'view', ...selectorArgs(cfg, parsePrRef(ref), repoArg), '--json', PR_DETAIL_FIELDS]
  const result = await execGh(cfg, args, {}, run)
  return normalizePrDetail(parseGhJson<RawPr>('pr view', result))
}

// ---------------------------------------------------------------------------
// checks

const CHECK_FIELDS = 'name,state,bucket,workflow,link'

export interface RawCheck {
  name?: string
  state?: string
  bucket?: string
  workflow?: string | null
  link?: string | null
}

export interface ChecksSummary {
  total: number
  pass: number
  fail: number
  pending: number
  skipped: number
  cancelled: number
  failing: { name: string; workflow: string | null; link: string | null }[]
}

export function summarizeChecks(raw: RawCheck[]): ChecksSummary {
  const summary: ChecksSummary = { total: raw.length, pass: 0, fail: 0, pending: 0, skipped: 0, cancelled: 0, failing: [] }
  for (const check of raw) {
    switch (check.bucket) {
      case 'pass':
        summary.pass++
        break
      case 'fail':
        summary.fail++
        summary.failing.push({ name: check.name ?? '', workflow: check.workflow ?? null, link: check.link ?? null })
        break
      case 'skipping':
        summary.skipped++
        break
      case 'cancel':
        summary.cancelled++
        break
      default:
        summary.pending++
    }
  }
  return summary
}

export async function getPrChecks(
  cfg: GithubConfig,
  ref: string,
  repoArg: string | undefined,
  run: GhRunner = runProcess,
): Promise<ChecksSummary> {
  const args = ['pr', 'checks', ...selectorArgs(cfg, parsePrRef(ref), repoArg), '--json', CHECK_FIELDS]
  // gh pr checks exits 1 when checks failed and 8 when pending — both still
  // print the JSON. Anything else on those codes (auth, no repo) has no JSON,
  // so parse first and only then judge the exit.
  const result = await execGh(cfg, args, { okExitCodes: [0, 1, 8] }, run)
  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    parsed = null
  }
  if (Array.isArray(parsed)) return summarizeChecks(parsed as RawCheck[])
  if (/no checks reported/i.test(result.stderr)) return summarizeChecks([])
  throw ghFailure(args, result)
}

// ---------------------------------------------------------------------------
// diffs

export interface PrDiff {
  files?: string[]
  patch?: string
  truncated: boolean
}

export async function getPrDiff(
  cfg: GithubConfig,
  ref: string,
  opts: { repo?: string; nameOnly?: boolean },
  run: GhRunner = runProcess,
): Promise<PrDiff> {
  const args = [
    'pr',
    'diff',
    ...selectorArgs(cfg, parsePrRef(ref), opts.repo),
    ...(opts.nameOnly ? ['--name-only'] : []),
  ]
  const result = await execGh(cfg, args, { maxOutputBytes: DIFF_MAX_BYTES }, run)
  if (opts.nameOnly) {
    const lines = result.stdout.split('\n').filter(Boolean)
    // A truncated stream can end mid-filename — drop the suspect last entry.
    if (result.stdoutTruncated) lines.pop()
    return { files: lines, truncated: result.stdoutTruncated }
  }
  return { patch: result.stdout, truncated: result.stdoutTruncated }
}

// ---------------------------------------------------------------------------
// workflow runs

const RUN_LIST_FIELDS = 'databaseId,number,name,displayTitle,workflowName,headBranch,event,status,conclusion,createdAt,updatedAt,url'
const RUN_DETAIL_FIELDS = `${RUN_LIST_FIELDS},attempt,startedAt,headSha,jobs`

interface RawRunJob {
  name?: string
  status?: string
  conclusion?: string | null
  startedAt?: string
  completedAt?: string
  url?: string
}

interface RawRun {
  databaseId?: number
  number?: number
  name?: string
  displayTitle?: string
  workflowName?: string
  headBranch?: string
  event?: string
  status?: string
  conclusion?: string | null
  createdAt?: string
  updatedAt?: string
  url?: string
  attempt?: number
  startedAt?: string
  headSha?: string
  jobs?: RawRunJob[]
}

export interface RunSummary {
  id: number
  number: number
  workflow: string
  title: string
  branch: string
  event: string
  status: string
  conclusion: string | null
  createdAt: string | null
  updatedAt: string | null
  url: string
}

export function normalizeRunSummary(raw: RawRun): RunSummary {
  return {
    id: raw.databaseId ?? 0,
    number: raw.number ?? 0,
    workflow: raw.workflowName ?? raw.name ?? '',
    title: raw.displayTitle ?? '',
    branch: raw.headBranch ?? '',
    event: raw.event ?? '',
    status: raw.status ?? '',
    conclusion: raw.conclusion || null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    url: raw.url ?? '',
  }
}

function durationSeconds(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null
  const ms = Date.parse(end) - Date.parse(start)
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null
}

export interface RunDetail extends RunSummary {
  attempt: number
  startedAt: string | null
  headSha: string
  durationSeconds: number | null
  jobs: {
    name: string
    status: string
    conclusion: string | null
    startedAt: string | null
    completedAt: string | null
    durationSeconds: number | null
    url: string
  }[]
}

export function normalizeRunDetail(raw: RawRun): RunDetail {
  return {
    ...normalizeRunSummary(raw),
    attempt: raw.attempt ?? 1,
    startedAt: raw.startedAt ?? null,
    headSha: raw.headSha ?? '',
    durationSeconds: durationSeconds(raw.startedAt, raw.updatedAt),
    jobs: (raw.jobs ?? []).map((job) => ({
      name: job.name ?? '',
      status: job.status ?? '',
      conclusion: job.conclusion || null,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      durationSeconds: durationSeconds(job.startedAt, job.completedAt),
      url: job.url ?? '',
    })),
  }
}

export interface RunListOptions {
  repo?: string
  branch?: string
  status?: string
  limit?: number
}

export async function listRuns(
  cfg: GithubConfig,
  opts: RunListOptions,
  run: GhRunner = runProcess,
): Promise<RunSummary[]> {
  const args = [
    'run',
    'list',
    ...repoFlagArgs(cfg, opts.repo),
    ...(opts.branch ? ['--branch', opts.branch] : []),
    ...(opts.status ? ['--status', opts.status] : []),
    '--limit',
    String(opts.limit ?? DEFAULT_LIMIT),
    '--json',
    RUN_LIST_FIELDS,
  ]
  const result = await execGh(cfg, args, {}, run)
  return parseGhJson<RawRun[]>('run list', result).map(normalizeRunSummary)
}

export async function getRun(
  cfg: GithubConfig,
  id: string,
  repoArg: string | undefined,
  run: GhRunner = runProcess,
): Promise<RunDetail> {
  const trimmed = id.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new UserError(`expected a numeric run id — got ${JSON.stringify(id)}`, 'bad_arg')
  }
  const args = ['run', 'view', trimmed, ...repoFlagArgs(cfg, repoArg), '--json', RUN_DETAIL_FIELDS]
  const result = await execGh(cfg, args, {}, run)
  return normalizeRunDetail(parseGhJson<RawRun>('run view', result))
}

// ---------------------------------------------------------------------------
// issues

const ISSUE_LIST_FIELDS = 'number,title,state,author,labels,assignees,createdAt,updatedAt,url'
const ISSUE_DETAIL_FIELDS = `${ISSUE_LIST_FIELDS},body,closedAt,stateReason,milestone,comments`

interface RawComment {
  author?: RawActor | null
  body?: string
  createdAt?: string
  url?: string
}

interface RawIssue {
  number?: number
  title?: string
  state?: string
  author?: RawActor | null
  labels?: RawLabel[]
  assignees?: RawActor[]
  createdAt?: string
  updatedAt?: string
  url?: string
  body?: string | null
  closedAt?: string | null
  stateReason?: string
  milestone?: { title?: string } | null
  comments?: RawComment[]
}

export interface IssueSummary {
  number: number
  title: string
  state: string
  author: string | null
  labels: string[]
  assignees: string[]
  createdAt: string | null
  updatedAt: string | null
  url: string
}

export function normalizeIssueSummary(raw: RawIssue): IssueSummary {
  return {
    number: raw.number ?? 0,
    title: raw.title ?? '',
    state: raw.state ?? '',
    author: raw.author?.login ?? null,
    labels: (raw.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
    assignees: (raw.assignees ?? []).map((a) => a.login ?? '').filter(Boolean),
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    url: raw.url ?? '',
  }
}

export interface IssueComment {
  author: string | null
  createdAt: string | null
  body: string
  bodyTruncated: boolean
}

export interface BoundedComments {
  comments: IssueComment[]
  totalComments: number
  commentsTruncated: boolean
}

/** Keep only the newest MAX_COMMENTS comments, each body capped, so one hot issue can't flood the context. */
export function boundComments(raw: RawComment[]): BoundedComments {
  const kept = raw.slice(-MAX_COMMENTS)
  return {
    comments: kept.map((c) => {
      const body = boundText(c.body, COMMENT_MAX_CHARS)
      return {
        author: c.author?.login ?? null,
        createdAt: c.createdAt ?? null,
        body: body.text,
        bodyTruncated: body.truncated,
      }
    }),
    totalComments: raw.length,
    commentsTruncated: raw.length > kept.length,
  }
}

export interface IssueDetail extends IssueSummary {
  body: string
  bodyTruncated: boolean
  closedAt: string | null
  stateReason: string
  milestone: string | null
  comments: IssueComment[]
  totalComments: number
  commentsTruncated: boolean
}

export function normalizeIssueDetail(raw: RawIssue): IssueDetail {
  const body = boundText(raw.body, BODY_MAX_CHARS)
  return {
    ...normalizeIssueSummary(raw),
    body: body.text,
    bodyTruncated: body.truncated,
    closedAt: raw.closedAt ?? null,
    stateReason: raw.stateReason ?? '',
    milestone: raw.milestone?.title ?? null,
    ...boundComments(raw.comments ?? []),
  }
}

export interface IssueListOptions {
  repo?: string
  state?: string
  label?: string
  limit?: number
}

export async function listIssues(
  cfg: GithubConfig,
  opts: IssueListOptions,
  run: GhRunner = runProcess,
): Promise<IssueSummary[]> {
  const args = [
    'issue',
    'list',
    ...repoFlagArgs(cfg, opts.repo),
    ...(opts.state ? ['--state', opts.state] : []),
    ...(opts.label ? ['--label', opts.label] : []),
    '--limit',
    String(opts.limit ?? DEFAULT_LIMIT),
    '--json',
    ISSUE_LIST_FIELDS,
  ]
  const result = await execGh(cfg, args, {}, run)
  return parseGhJson<RawIssue[]>('issue list', result).map(normalizeIssueSummary)
}

export async function getIssue(
  cfg: GithubConfig,
  ref: string,
  repoArg: string | undefined,
  run: GhRunner = runProcess,
): Promise<IssueDetail> {
  const args = ['issue', 'view', ...selectorArgs(cfg, parseIssueRef(ref), repoArg), '--json', ISSUE_DETAIL_FIELDS]
  const result = await execGh(cfg, args, {}, run)
  return normalizeIssueDetail(parseGhJson<RawIssue>('issue view', result))
}

// ---------------------------------------------------------------------------
// notifications

/** The notifications API caps per_page at 50, unlike most list endpoints. */
const NOTIFICATIONS_MAX_PAGE = 50

// A --reason filter is applied client-side, so a sparse reason may need more
// than one 50-row page to reach `limit`. Bound the walk so a rare reason on a
// large inbox can't fan out into unbounded API calls: 10 pages = up to 500
// notifications scanned.
const NOTIFICATIONS_PAGE_CAP = 10

/** gh api has no --repo; a non-default host rides --hostname instead. */
function apiHostArgs(cfg: GithubConfig): string[] {
  return cfg.host === 'github.com' ? [] : ['--hostname', cfg.host]
}

interface RawNotification {
  id?: string
  unread?: boolean
  reason?: string
  updated_at?: string
  subject?: { title?: string; url?: string | null; type?: string } | null
  repository?: { full_name?: string } | null
}

export interface NotificationItem {
  id: string
  reason: string
  repo: string
  title: string
  type: string
  url: string | null
  updatedAt: string | null
  unread: boolean
}

export function normalizeNotification(raw: RawNotification): NotificationItem {
  return {
    id: raw.id ?? '',
    reason: raw.reason ?? '',
    repo: raw.repository?.full_name ?? '',
    title: raw.subject?.title ?? '',
    type: raw.subject?.type ?? '',
    url: raw.subject?.url ?? null,
    updatedAt: raw.updated_at ?? null,
    unread: raw.unread ?? false,
  }
}

export interface NotificationListOptions {
  reason?: string
  limit?: number
}

export async function listNotifications(
  cfg: GithubConfig,
  opts: NotificationListOptions,
  run: GhRunner = runProcess,
): Promise<NotificationItem[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const reason = opts.reason?.trim().toLowerCase()
  // The reason filter is ours, not the API's, so fetch full pages when one is
  // set; otherwise `limit` rows (bounded by the API's own 50) is all we need.
  const perPage = reason ? NOTIFICATIONS_MAX_PAGE : Math.min(limit, NOTIFICATIONS_MAX_PAGE)
  const collected: NotificationItem[] = []
  for (let page = 1; page <= NOTIFICATIONS_PAGE_CAP; page++) {
    const query = `notifications?per_page=${perPage}${page > 1 ? `&page=${page}` : ''}`
    const result = await execGh(cfg, ['api', ...apiHostArgs(cfg), query], {}, run)
    const rows = parseGhJson<RawNotification[]>('api notifications', result).map(normalizeNotification)
    for (const item of rows) {
      if (!reason || item.reason === reason) collected.push(item)
    }
    if (collected.length >= limit || rows.length < perPage) break
  }
  return collected.slice(0, limit)
}

// ---------------------------------------------------------------------------
// releases

interface RawRelease {
  tag_name?: string
  name?: string | null
  draft?: boolean
  prerelease?: boolean
  published_at?: string | null
  html_url?: string
}

export interface ReleaseItem {
  tag: string
  name: string | null
  publishedAt: string | null
  prerelease: boolean
  draft: boolean
  url: string
}

export function normalizeRelease(raw: RawRelease): ReleaseItem {
  return {
    tag: raw.tag_name ?? '',
    name: raw.name ?? null,
    publishedAt: raw.published_at ?? null,
    prerelease: raw.prerelease ?? false,
    draft: raw.draft ?? false,
    url: raw.html_url ?? '',
  }
}

/**
 * Path segment for `gh api repos/<owner>/<name>/...`. When nothing resolves,
 * gh's {owner}/{repo} placeholders make it infer from the cwd checkout — the
 * gh-api analogue of omitting --repo. A host prefix never belongs in an API
 * path; apiHostArgs carries it.
 */
function apiRepoPath(cfg: GithubConfig, repoArg: string | undefined): string {
  const value = resolveRepoFlag(cfg, repoArg)
  if (!value) return '{owner}/{repo}'
  return value.split('/').slice(-2).join('/')
}

export interface ReleaseListOptions {
  repo?: string
  limit?: number
}

/**
 * `gh release list --json` has no URL field, so this goes through the REST
 * endpoint, which has html_url and the same flags otherwise.
 */
export async function listReleases(
  cfg: GithubConfig,
  opts: ReleaseListOptions,
  run: GhRunner = runProcess,
): Promise<ReleaseItem[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const args = ['api', ...apiHostArgs(cfg), `repos/${apiRepoPath(cfg, opts.repo)}/releases?per_page=${limit}`]
  const result = await execGh(cfg, args, {}, run)
  return parseGhJson<RawRelease[]>('api releases', result).map(normalizeRelease)
}

// ---------------------------------------------------------------------------
// code search

const MAX_FRAGMENTS = 3
const FRAGMENT_MAX_CHARS = 300

interface RawCodeMatch {
  path?: string
  repository?: { nameWithOwner?: string } | null
  url?: string
  textMatches?: { fragment?: string }[]
}

export interface CodeSearchItem {
  repo: string
  path: string
  url: string
  fragments: string[]
}

export function normalizeCodeMatch(raw: RawCodeMatch): CodeSearchItem {
  return {
    repo: raw.repository?.nameWithOwner ?? '',
    path: raw.path ?? '',
    url: raw.url ?? '',
    fragments: (raw.textMatches ?? [])
      .slice(0, MAX_FRAGMENTS)
      .map((m) => boundText(m.fragment, FRAGMENT_MAX_CHARS).text)
      .filter(Boolean),
  }
}

export interface CodeSearchOptions {
  owner?: string
  repo?: string
  limit?: number
}

/**
 * Code search is global by design, so --repo here is a plain qualifier with
 * no defaultRepo/cwd fallback — an implicit narrowing would silently hide
 * hits everywhere else.
 */
export async function searchCode(
  cfg: GithubConfig,
  query: string,
  opts: CodeSearchOptions,
  run: GhRunner = runProcess,
): Promise<CodeSearchItem[]> {
  const q = query.trim()
  if (!q) throw new UserError('search query must not be empty', 'bad_arg')
  const repo = opts.repo?.trim()
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new UserError(`--repo must be owner/name — got ${JSON.stringify(opts.repo)}`, 'bad_arg')
  }
  // The query goes last, behind a `--` separator: gh's own help mandates it
  // for hyphen-prefixed qualifiers, and without it a flag-shaped query like
  // `-w` is parsed as gh's --web flag — opening a browser from a read-only
  // command. gh (cobra) drops flag parsing after `--`, so every flag must
  // precede it.
  const args = [
    'search',
    'code',
    ...(opts.owner ? ['--owner', opts.owner] : []),
    ...(repo ? ['--repo', repo] : []),
    '--limit',
    String(opts.limit ?? DEFAULT_LIMIT),
    '--json',
    'path,repository,url,textMatches',
    '--',
    q,
  ]
  const result = await execGh(cfg, args, {}, run)
  return parseGhJson<RawCodeMatch[]>('search code', result).map(normalizeCodeMatch)
}

// ---------------------------------------------------------------------------
// summary briefing

const SUMMARY_PR_LIMIT = 20
const SUMMARY_RUN_LIMIT = 10
const MAX_FAILING_CHECKS = 10

const SUMMARY_PR_FIELDS = 'number,title,isDraft,headRefName,url,updatedAt,statusCheckRollup'
const REVIEW_REQUEST_FIELDS = 'number,title,author,isDraft,url,updatedAt'

/** CheckRun rows carry status/conclusion; StatusContext rows carry state. */
interface RawRollupItem {
  name?: string
  context?: string
  status?: string
  conclusion?: string | null
  state?: string
  detailsUrl?: string | null
  targetUrl?: string | null
}

export interface RollupSummary {
  total: number
  failed: number
  pending: number
  failing: { name: string; url: string | null }[]
}

const FAILURE_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE'])
const FAILURE_STATES = new Set(['FAILURE', 'ERROR'])
const PENDING_STATES = new Set(['PENDING', 'EXPECTED'])

export function summarizeRollup(items: RawRollupItem[]): RollupSummary {
  const summary: RollupSummary = { total: items.length, failed: 0, pending: 0, failing: [] }
  for (const item of items) {
    const isFailed = item.state
      ? FAILURE_STATES.has(item.state)
      : FAILURE_CONCLUSIONS.has(item.conclusion ?? '')
    const isPending = item.state ? PENDING_STATES.has(item.state) : (item.status ?? '') !== 'COMPLETED'
    if (isFailed) {
      summary.failed++
      if (summary.failing.length < MAX_FAILING_CHECKS) {
        summary.failing.push({
          name: item.name ?? item.context ?? '',
          url: item.detailsUrl ?? item.targetUrl ?? null,
        })
      }
    } else if (isPending) {
      summary.pending++
    }
  }
  return summary
}

export function repoFromUrl(url: string): string | null {
  const match = /^https?:\/\/[^/]+\/([^/\s]+\/[^/\s]+)\//.exec(url)
  return match?.[1] ?? null
}

interface RawSummaryPr extends RawPr {
  statusCheckRollup?: RawRollupItem[]
}

export interface SummaryPr {
  number: number
  title: string
  isDraft: boolean
  headRef: string
  url: string
  repo: string | null
  updatedAt: string | null
  checks: RollupSummary
}

export interface ReviewRequestPr {
  number: number
  title: string
  author: string | null
  isDraft: boolean
  url: string
  repo: string | null
  updatedAt: string | null
}

export interface SummaryRun extends RunSummary {
  repo: string | null
}

export interface GithubSummary {
  myOpenPrs: SummaryPr[]
  reviewRequested: ReviewRequestPr[]
  failedRuns: SummaryRun[]
}

function normalizeSummaryPr(raw: RawSummaryPr): SummaryPr {
  const url = raw.url ?? ''
  return {
    number: raw.number ?? 0,
    title: raw.title ?? '',
    isDraft: raw.isDraft ?? false,
    headRef: raw.headRefName ?? '',
    url,
    repo: repoFromUrl(url),
    updatedAt: raw.updatedAt ?? null,
    checks: summarizeRollup(raw.statusCheckRollup ?? []),
  }
}

function normalizeReviewRequest(raw: RawPr): ReviewRequestPr {
  const url = raw.url ?? ''
  return {
    number: raw.number ?? 0,
    title: raw.title ?? '',
    author: raw.author?.login ?? null,
    isDraft: raw.isDraft ?? false,
    url,
    repo: repoFromUrl(url),
    updatedAt: raw.updatedAt ?? null,
  }
}

/**
 * One briefing from exactly three gh calls — no per-PR fan-out. Failing checks
 * on my PRs come from pr list's statusCheckRollup, review requests from a
 * search qualifier, failed runs from run list's status filter.
 */
export async function getSummary(
  cfg: GithubConfig,
  repoArg: string | undefined,
  run: GhRunner = runProcess,
): Promise<GithubSummary> {
  const repoFlag = repoFlagArgs(cfg, repoArg)
  const mineArgs = [
    'pr',
    'list',
    ...repoFlag,
    '--author',
    '@me',
    '--limit',
    String(SUMMARY_PR_LIMIT),
    '--json',
    SUMMARY_PR_FIELDS,
  ]
  const reviewArgs = [
    'pr',
    'list',
    ...repoFlag,
    '--search',
    'review-requested:@me',
    '--limit',
    String(SUMMARY_PR_LIMIT),
    '--json',
    REVIEW_REQUEST_FIELDS,
  ]
  const runsArgs = [
    'run',
    'list',
    ...repoFlag,
    '--status',
    'failure',
    '--limit',
    String(SUMMARY_RUN_LIMIT),
    '--json',
    RUN_LIST_FIELDS,
  ]
  const [mine, review, failed] = await Promise.all([
    execGh(cfg, mineArgs, {}, run),
    execGh(cfg, reviewArgs, {}, run),
    execGh(cfg, runsArgs, {}, run),
  ])
  return {
    myOpenPrs: parseGhJson<RawSummaryPr[]>('pr list', mine).map(normalizeSummaryPr),
    reviewRequested: parseGhJson<RawPr[]>('pr list', review).map(normalizeReviewRequest),
    failedRuns: parseGhJson<RawRun[]>('run list', failed).map((raw) => {
      const summary = normalizeRunSummary(raw)
      return { ...summary, repo: repoFromUrl(summary.url) }
    }),
  }
}

// ---------------------------------------------------------------------------
// auth

interface RawAuthEntry {
  state?: string
  active?: boolean
  login?: string
}

interface RawAuthStatus {
  hosts?: Record<string, RawAuthEntry[]>
}

export interface AuthStatus {
  authenticated: boolean
  login: string | null
}

export function parseAuthStatus(raw: RawAuthStatus, host: string): AuthStatus {
  const entries = raw.hosts?.[host] ?? []
  const account = entries.find((e) => e.active) ?? entries[0]
  if (!account) return { authenticated: false, login: null }
  return { authenticated: account.state === 'success', login: account.login ?? null }
}

/**
 * One bounded gh invocation; never needs the cwd to be a git repo. gh's
 * `--json` variant of auth status exits 0 even when unauthenticated, so the
 * answer comes from the payload, not the exit code.
 */
export async function checkAuth(cfg: GithubConfig, run: GhRunner = runProcess): Promise<AuthStatus> {
  const args = ['auth', 'status', '--hostname', cfg.host, '--active', '--json', 'hosts']
  const result = await execGh(cfg, args, { timeoutMs: AUTH_TIMEOUT_MS, okExitCodes: [0, 1] }, run)
  if (/unknown flag: --json/i.test(result.stderr)) {
    throw new SystemError(
      'this gh does not support `auth status --json` — upgrade GitHub CLI to 2.63 or newer',
      'github_api_failed',
    )
  }
  if ((result.exitCode ?? -1) !== 0) throw ghFailure(args, result)
  return parseAuthStatus(parseGhJson<RawAuthStatus>('auth status', result), cfg.host)
}
