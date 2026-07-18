import { SystemError, UserError } from '../../core/errors'
import { runProcess, type ProcessResult } from '../../core/process'
import type { ModuleConfig } from '../../core/types'

export type GtRunner = typeof runProcess

/** The gt release these parsers were written against — gt has no JSON output, so text shapes are version-bound. */
export const TESTED_GT_VERSION = '1.8.6'
const TESTED_GT_MAJOR = 1

const GT_TIMEOUT_MS = 30_000
const VERSION_TIMEOUT_MS = 10_000
/** gt info passes whole commit logs through — keep the preserved raw text bounded. */
const RAW_MAX_CHARS = 20_000
/** Per-branch topology lookups fan out one gt invocation each — hard cap the fan-out. */
const TOPOLOGY_FANOUT_CAP = 25

export interface GraphiteConfig {
  binaryPath: string
  defaultTrunk?: string
}

export function readGraphiteConfig(cfg: ModuleConfig): GraphiteConfig {
  const binaryPath = String(cfg.binaryPath ?? '').trim() || 'gt'
  const defaultTrunk = String(cfg.defaultTrunk ?? '').trim()
  return { binaryPath, ...(defaultTrunk ? { defaultTrunk } : {}) }
}

/** gt colorizes the git-log passthrough in `gt info` even when piped. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}

export interface BoundedRaw {
  raw: string
  rawTruncated: boolean
}

export function boundRaw(text: string, alreadyTruncated: boolean): BoundedRaw {
  const clean = stripAnsi(text)
  if (clean.length <= RAW_MAX_CHARS) return { raw: clean, rawTruncated: alreadyTruncated }
  return { raw: clean.slice(0, RAW_MAX_CHARS), rawTruncated: true }
}

const NOT_REPO_RE = /must run this command from within a git repository/i
const TRUNK_OP_RE = /cannot perform this operation on the trunk branch/i
const UNTRACKED_RE = /cannot perform this operation on untracked branch/i
const NOT_FOUND_RE = /could not find branch/i

/** Map a nonzero gt exit to a stable error code; gt's own text stays in the message, labeled. */
export function gtFailure(args: readonly string[], result: ProcessResult): SystemError | UserError {
  const combined = stripAnsi(`${result.stderr}\n${result.stdout}`)
  const detail = firstLine(stripAnsi(result.stderr)) || firstLine(stripAnsi(result.stdout)) || `exit ${result.exitCode}`
  if (NOT_REPO_RE.test(combined)) {
    return new UserError(`this command needs a git working tree — run it inside a repository (gt: ${detail})`, 'graphite_not_repo')
  }
  if (UNTRACKED_RE.test(combined)) {
    return new UserError(`gt: ${detail}`, 'graphite_untracked_branch')
  }
  if (NOT_FOUND_RE.test(combined)) {
    return new UserError(`gt: ${detail}`, 'graphite_failed')
  }
  const what = args.slice(0, 2).join(' ')
  return new SystemError(`gt ${what} failed (exit ${result.exitCode}): ${detail}`, 'graphite_failed')
}

interface ExecOptions {
  timeoutMs?: number
  /** Exit codes whose output the caller wants to judge itself (e.g. `gt parent` exits 1 on trunk). */
  okExitCodes?: readonly number[]
}

export async function execGt(
  cfg: GraphiteConfig,
  args: readonly string[],
  opts: ExecOptions = {},
  run: GtRunner = runProcess,
): Promise<ProcessResult> {
  const timeoutMs = opts.timeoutMs ?? GT_TIMEOUT_MS
  let result: ProcessResult
  try {
    result = await run([cfg.binaryPath, ...args], { timeoutMs })
  } catch (err) {
    if (err instanceof SystemError && err.code === 'process_not_found') {
      throw new SystemError(
        `gt binary not found (${JSON.stringify(cfg.binaryPath)}) — install the Graphite CLI (https://graphite.com/docs/install-the-cli) or set binaryPath via \`home graphite configure\``,
        'graphite_gt_missing',
      )
    }
    throw err
  }
  if (result.timedOut) {
    throw new SystemError(`gt ${args.slice(0, 2).join(' ')} timed out after ${timeoutMs}ms`, 'graphite_failed')
  }
  const okExitCodes = opts.okExitCodes ?? [0]
  if (!okExitCodes.includes(result.exitCode ?? -1)) throw gtFailure(args, result)
  return result
}

// ---------------------------------------------------------------------------
// version

export interface GtVersion {
  version: string
  major: number
  minor: number
  patch: number
  /** Same MAJOR as the gt this module was written against — parsers are text-shape-bound. */
  compatible: boolean
  testedVersion: string
}

export function parseGtVersion(stdout: string): GtVersion | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(stdout)
  if (!m) return null
  const major = Number(m[1])
  return {
    version: m[0],
    major,
    minor: Number(m[2]),
    patch: Number(m[3]),
    compatible: major === TESTED_GT_MAJOR,
    testedVersion: TESTED_GT_VERSION,
  }
}

/** Works anywhere — `gt --version` needs no git working tree. */
export async function getGtVersion(cfg: GraphiteConfig, run: GtRunner = runProcess): Promise<GtVersion> {
  const result = await execGt(cfg, ['--version'], { timeoutMs: VERSION_TIMEOUT_MS }, run)
  const version = parseGtVersion(result.stdout)
  if (!version) {
    throw new SystemError(`gt --version printed no semver: ${JSON.stringify(firstLine(result.stdout))}`, 'graphite_failed')
  }
  return version
}

// ---------------------------------------------------------------------------
// trunk

export async function getTrunk(cfg: GraphiteConfig, run: GtRunner = runProcess): Promise<string> {
  const result = await execGt(cfg, ['trunk', '--no-interactive'], {}, run)
  const trunk = firstLine(stripAnsi(result.stdout))
  if (!trunk) throw new SystemError('gt trunk printed nothing', 'graphite_failed')
  return trunk
}

/** Trunk for comparisons, with the configured defaultTrunk as fallback when gt itself can't say. */
async function resolveTrunk(cfg: GraphiteConfig, run: GtRunner): Promise<string | null> {
  try {
    return await getTrunk(cfg, run)
  } catch (err) {
    if (err instanceof UserError && err.code === 'graphite_not_repo') throw err
    return cfg.defaultTrunk ?? null
  }
}

// ---------------------------------------------------------------------------
// branch info (gt info)

export interface BranchInfo {
  branch: string
  parent: string | null
  pr: { number: number; state: string | null; title: string } | null
  prUrl: string | null
  commit: string | null
  raw: string
  rawTruncated: boolean
}

/**
 * gt info is human-oriented text with no machine format promised — the first
 * line, `PR #N (State) title`, the graphite URL, and `Parent: x` are parsed
 * best-effort; everything gt printed stays available in `raw` (bounded).
 * The `Children:` section is NOT parsed: gt 1.8.6 renders it empty even for
 * branches that have children.
 */
export function parseBranchInfo(result: ProcessResult): BranchInfo {
  const text = stripAnsi(result.stdout)
  const pr = /^PR #(\d+)(?:\s+\(([^)]+)\))?\s*(.*)$/m.exec(text)
  return {
    branch: firstLine(text),
    parent: /^Parent:\s*(\S+)/m.exec(text)?.[1] ?? null,
    pr: pr ? { number: Number(pr[1]), state: pr[2] ?? null, title: (pr[3] ?? '').trim() } : null,
    prUrl: /^https:\/\/\S+$/m.exec(text)?.[0] ?? null,
    commit: /^commit ([0-9a-f]{7,40})\b/m.exec(text)?.[1] ?? null,
    ...boundRaw(result.stdout, result.stdoutTruncated),
  }
}

export async function getBranchInfo(
  cfg: GraphiteConfig,
  branch: string | undefined,
  run: GtRunner = runProcess,
): Promise<BranchInfo> {
  const args = ['info', ...(branch ? ['--branch', branch] : []), '--no-interactive']
  const result = await execGt(cfg, args, {}, run)
  return parseBranchInfo(result)
}

// ---------------------------------------------------------------------------
// stack list (gt log short)

export interface StackBranch {
  name: string
  /** Trailing parenthetical gt prints after the name (worktree name, restack marker) — decorative, best-effort. */
  note: string | null
  needsRestack: boolean
  /** Set by the bounded per-branch lookup: string = parent, null = no parent (trunk), absent = not looked up. */
  parent?: string | null
}

export interface StackList {
  raw: string
  rawTruncated: boolean
  branches: StackBranch[]
  topology: { scanned: number; truncated: boolean }
}

/**
 * Pull branch names out of gt log short. The graph glyphs (◯ ◉ │ ─ ┴ ┘) are
 * decorative and deliberately never interpreted — the first ASCII word on each
 * line is the branch name, and authoritative topology comes from per-branch
 * gt lookups, not from the drawing.
 */
export function parseLogShort(stdout: string): StackBranch[] {
  const branches: StackBranch[] = []
  for (const line of stripAnsi(stdout).split('\n')) {
    const name = /[A-Za-z0-9][\w./-]*/.exec(line)?.[0]
    if (!name) continue
    const rest = line.slice(line.indexOf(name) + name.length)
    branches.push({
      name,
      note: /\(([^)]+)\)/.exec(rest)?.[1] ?? null,
      needsRestack: /needs restack/i.test(rest),
    })
  }
  return branches
}

/** One bounded gt info per branch, in parallel, capped — a lookup failure leaves that parent absent. */
async function fetchParents(
  cfg: GraphiteConfig,
  names: readonly string[],
  run: GtRunner,
): Promise<{ parents: Map<string, string | null>; scanned: number; truncated: boolean }> {
  const capped = names.slice(0, TOPOLOGY_FANOUT_CAP)
  const parents = new Map<string, string | null>()
  await Promise.all(
    capped.map(async (name) => {
      try {
        parents.set(name, (await getBranchInfo(cfg, name, run)).parent)
      } catch {
        // leave the entry absent — undefined parent means "not determined", never "trunk"
      }
    }),
  )
  return { parents, scanned: capped.length, truncated: names.length > capped.length }
}

export async function listStack(
  cfg: GraphiteConfig,
  opts: { all?: boolean },
  run: GtRunner = runProcess,
): Promise<StackList> {
  const args = ['log', 'short', ...(opts.all ? ['--all'] : []), '--no-interactive']
  const result = await execGt(cfg, args, {}, run)
  const branches = parseLogShort(result.stdout)
  const { parents, scanned, truncated } = await fetchParents(cfg, branches.map((b) => b.name), run)
  for (const branch of branches) {
    if (parents.has(branch.name)) branch.parent = parents.get(branch.name) ?? null
  }
  return { ...boundRaw(result.stdout, result.stdoutTruncated), branches, topology: { scanned, truncated } }
}

// ---------------------------------------------------------------------------
// parent / children

export interface ParentInfo {
  /** null when gt answered for the current branch without naming it. */
  branch: string | null
  parent: string | null
  isTrunk: boolean
}

/**
 * gt 1.8.6's `gt parent` takes no branch argument — it only answers for the
 * current branch (and exits 1 with a trunk message when on trunk). A named
 * branch goes through gt info's `Parent:` line instead.
 */
export async function getParent(
  cfg: GraphiteConfig,
  branch: string | undefined,
  run: GtRunner = runProcess,
): Promise<ParentInfo> {
  if (branch) {
    const info = await getBranchInfo(cfg, branch, run)
    return { branch: info.branch, parent: info.parent, isTrunk: info.parent === null }
  }
  const args = ['parent', '--no-interactive']
  const result = await execGt(cfg, args, { okExitCodes: [0, 1] }, run)
  if ((result.exitCode ?? -1) === 0) {
    const parent = firstLine(stripAnsi(result.stdout))
    if (parent) return { branch: null, parent, isTrunk: false }
  }
  if (TRUNK_OP_RE.test(stripAnsi(`${result.stderr}\n${result.stdout}`))) {
    return { branch: null, parent: null, isTrunk: true }
  }
  throw gtFailure(args, result)
}

export interface ChildrenInfo {
  branch: string | null
  children: string[]
  /** true when computed from per-branch parent lookups rather than gt children directly. */
  derived: boolean
  scanned?: number
  truncated?: boolean
}

/**
 * `gt children` also takes no branch argument in 1.8.6, and gt info's
 * Children: section renders empty — so a named branch's children are derived
 * by asking each tracked branch for its parent (bounded fan-out).
 */
export async function getChildren(
  cfg: GraphiteConfig,
  branch: string | undefined,
  run: GtRunner = runProcess,
): Promise<ChildrenInfo> {
  if (!branch) {
    const result = await execGt(cfg, ['children', '--no-interactive'], {}, run)
    const children = stripAnsi(result.stdout)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    return { branch: null, children, derived: false }
  }
  const logResult = await execGt(cfg, ['log', 'short', '--no-interactive'], {}, run)
  const names = parseLogShort(logResult.stdout).map((b) => b.name)
  if (!names.includes(branch)) {
    throw new UserError(`branch ${JSON.stringify(branch)} is not tracked by graphite — run \`gt track\` first`, 'graphite_failed')
  }
  const others = names.filter((n) => n !== branch)
  const { parents, scanned, truncated } = await fetchParents(cfg, others, run)
  const children = others.filter((n) => parents.get(n) === branch)
  return { branch, children, derived: true, scanned, truncated }
}

// ---------------------------------------------------------------------------
// validate (non-mutating readiness)

export interface ValidateFinding {
  check: 'tracked' | 'parent' | 'restack' | 'clean_worktree'
  ok: boolean
  detail: string
}

export interface ValidateReport {
  branch: string | null
  ready: boolean
  findings: ValidateFinding[]
}

export async function validateBranch(
  cfg: GraphiteConfig,
  branchArg: string | undefined,
  run: GtRunner = runProcess,
): Promise<ValidateReport> {
  const findings: ValidateFinding[] = []

  const infoArgs = ['info', ...(branchArg ? ['--branch', branchArg] : []), '--no-interactive']
  const infoResult = await execGt(cfg, infoArgs, { okExitCodes: [0, 1] }, run)
  let info: BranchInfo | null = null
  if ((infoResult.exitCode ?? -1) === 0) {
    info = parseBranchInfo(infoResult)
  } else {
    const combined = stripAnsi(`${infoResult.stderr}\n${infoResult.stdout}`)
    if (!UNTRACKED_RE.test(combined) && !NOT_FOUND_RE.test(combined)) throw gtFailure(infoArgs, infoResult)
    findings.push({ check: 'tracked', ok: false, detail: firstLine(combined).replace(/^ERROR:\s*/, '') })
  }

  const branch = info?.branch ?? branchArg ?? null
  if (info) {
    findings.push({ check: 'tracked', ok: true, detail: `${info.branch} is tracked by graphite` })

    if (info.parent) {
      findings.push({ check: 'parent', ok: true, detail: `parent is ${info.parent}` })
    } else {
      const trunk = await resolveTrunk(cfg, run)
      const isTrunk = trunk !== null && info.branch === trunk
      findings.push({
        check: 'parent',
        ok: isTrunk,
        detail: isTrunk ? `${info.branch} is trunk — no parent expected` : 'no parent recorded — retrack with `gt track`',
      })
    }

    const logResult = await execGt(cfg, ['log', 'short', '--no-interactive'], {}, run)
    const entry = parseLogShort(logResult.stdout).find((b) => b.name === info.branch)
    const needsRestack = entry?.needsRestack ?? false
    findings.push({
      check: 'restack',
      ok: !needsRestack,
      detail: needsRestack ? 'gt marks this branch as needing restack — run `gt restack` yourself' : 'no restack marker in gt log',
    })
  }

  // Uncommitted changes block any restack regardless of which branch is being
  // judged — plain read-only git status, never gt.
  const git = await run(['git', 'status', '--porcelain'], { timeoutMs: GT_TIMEOUT_MS })
  if ((git.exitCode ?? -1) !== 0) {
    findings.push({ check: 'clean_worktree', ok: false, detail: `git status failed: ${firstLine(git.stderr) || `exit ${git.exitCode}`}` })
  } else {
    const dirty = git.stdout.trim()
    findings.push({
      check: 'clean_worktree',
      ok: !dirty,
      detail: dirty ? `uncommitted changes present (${dirty.split('\n').length} paths)` : 'working tree clean',
    })
  }

  return { branch, ready: findings.every((f) => f.ok), findings }
}

// ---------------------------------------------------------------------------
// status probe

export interface GraphiteStatusData {
  binaryPath: string
  version: string
  compatible: boolean
  testedVersion: string
  repository: { initialized: true; trunk: string | null } | null
}

/**
 * Binary + version first (needs no git cwd); the repository probe is
 * best-effort — outside a working tree it reports null rather than failing
 * the module.
 */
export async function probeGraphite(cfg: GraphiteConfig, run: GtRunner = runProcess): Promise<GraphiteStatusData> {
  const v = await getGtVersion(cfg, run)
  let repository: GraphiteStatusData['repository'] = null
  try {
    repository = { initialized: true, trunk: await getTrunk(cfg, run) }
  } catch (err) {
    if (err instanceof UserError && err.code === 'graphite_untracked_branch') {
      // gt names the trunk only from a tracked branch; an untracked current
      // branch means the repo is graphite-initialized but we can't read trunk.
      repository = { initialized: true, trunk: null }
    } else if (!(err instanceof UserError) || err.code !== 'graphite_not_repo') {
      throw err
    }
  }
  return {
    binaryPath: cfg.binaryPath,
    version: v.version,
    compatible: v.compatible,
    testedVersion: v.testedVersion,
    repository,
  }
}
