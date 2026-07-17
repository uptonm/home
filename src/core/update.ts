import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { runProcess } from './process'
import { paths } from './paths'
import { loadGlobalConfig, loadModuleConfig } from './config'
import { HOME_COMMIT, HOME_VERSION, IS_PACKAGED } from './version'

export const RELEASE_REPO = 'uptonm/home'

/** Runs `gh` — the private release repo is only reachable through its auth. */
export type GhRunner = typeof runProcess

const CHECK_TTL_MS = 24 * 60 * 60 * 1000
const SEMVER_RE = /^\d+\.\d+\.\d+/

export interface UpdateCache {
  latest: string
  checkedAt: number
}

/** How `latest` compares to `current`; `newer` means an upgrade is available. */
export type VersionRelation = 'newer' | 'same' | 'older' | 'unknown'

export function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/, '')
}

export function relation(current: string, latest: string): VersionRelation {
  const a = normalizeVersion(current)
  const b = normalizeVersion(latest)
  if (!SEMVER_RE.test(a) || !SEMVER_RE.test(b)) return 'unknown'
  const ord = Bun.semver.order(a, b)
  return ord < 0 ? 'newer' : ord > 0 ? 'older' : 'same'
}

export function isNewerAvailable(current: string, latest: string): boolean {
  return relation(current, latest) === 'newer'
}

export function bannerText(current: string, latest: string): string {
  return `▲ home v${normalizeVersion(latest)} available (you have v${normalizeVersion(current)}) — run \`home upgrade\``
}

export function readCache(): UpdateCache | null {
  try {
    if (!existsSync(paths.updateCache)) return null
    const raw = JSON.parse(readFileSync(paths.updateCache, 'utf8')) as Partial<UpdateCache>
    if (typeof raw.latest === 'string' && typeof raw.checkedAt === 'number') {
      return { latest: raw.latest, checkedAt: raw.checkedAt }
    }
    return null
  } catch {
    return null
  }
}

export function writeCache(cache: UpdateCache): void {
  // A best-effort cache — never let a write failure break the command that
  // triggered the refresh.
  try {
    mkdirSync(dirname(paths.updateCache), { recursive: true })
    const partial = `${paths.updateCache}.partial`
    writeFileSync(partial, JSON.stringify(cache) + '\n')
    renameSync(partial, paths.updateCache)
  } catch {
    /* ignore */
  }
}

export function cacheIsStale(cache: UpdateCache | null, now: number, ttlMs = CHECK_TTL_MS): boolean {
  if (!cache) return true
  return now - cache.checkedAt >= ttlMs
}

/** Resolve the gh binary from the github module's config, defaulting to PATH. */
export function ghBinary(): string {
  try {
    const cfg = loadModuleConfig('github')
    const bp = cfg && typeof cfg.binaryPath === 'string' ? cfg.binaryPath.trim() : ''
    return bp || 'gh'
  } catch {
    return 'gh'
  }
}

export function parseLatestTag(stdout: string): string | null {
  try {
    const body = JSON.parse(stdout) as { tagName?: string }
    const tag = normalizeVersion(body.tagName ?? '')
    return SEMVER_RE.test(tag) ? tag : null
  } catch {
    return null
  }
}

export async function fetchLatestVersion(run: GhRunner = runProcess): Promise<string | null> {
  try {
    const res = await run([ghBinary(), 'release', 'view', '--repo', RELEASE_REPO, '--json', 'tagName'], {
      timeoutMs: 15_000,
    })
    if (res.exitCode !== 0) return null
    return parseLatestTag(res.stdout)
  } catch {
    return null
  }
}

export interface UpdateInfo {
  current: string
  latest: string
  outOfDate: boolean
}

export async function checkUpdate(): Promise<UpdateInfo | { error: string }> {
  const latest = await fetchLatestVersion()
  if (!latest) return { error: 'could not fetch the latest release' }
  return { current: HOME_VERSION, latest, outOfDate: isNewerAvailable(HOME_VERSION, latest) }
}

/** Body of the hidden `home __update-check` command: refresh the cache, silently. */
export async function performUpdateCheck(now: number = Date.now()): Promise<void> {
  const latest = await fetchLatestVersion()
  if (latest) writeCache({ latest, checkedAt: now })
}

export interface BannerEnv {
  current: string
  packaged: boolean
  dirty: boolean
  isTTY: boolean
  json: boolean
  ci: boolean
  disabled: boolean
  cache: UpdateCache | null
}

/**
 * The single decision point for the preflight banner. Returns the banner
 * string, or null when any suppression rule applies — kept pure so the whole
 * suppression matrix is unit-testable without touching the filesystem, the
 * network, or a TTY.
 */
export function bannerFor(env: BannerEnv): string | null {
  if (!env.packaged || env.dirty || !env.isTTY || env.json || env.ci || env.disabled) return null
  if (!env.cache) return null
  return isNewerAvailable(env.current, env.cache.latest) ? bannerText(env.current, env.cache.latest) : null
}

function spawnBackgroundRefresh(): void {
  // Detach a child that re-invokes this same binary to refresh the cache for
  // the *next* run. unref() lets the current process exit without waiting.
  try {
    const proc = Bun.spawn({
      cmd: [process.execPath, '__update-check'],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    })
    proc.unref()
  } catch {
    /* best-effort */
  }
}

/**
 * Run before the command dispatches. Prints a one-line banner to stderr when a
 * cached newer version exists, and kicks off a detached refresh when the cache
 * is stale. Never blocks on the network and never throws — a broken preflight
 * must not break the command the user actually ran.
 */
export function preflight(argv: readonly string[]): void {
  try {
    const dirty = HOME_COMMIT.endsWith('-dirty') || HOME_COMMIT === 'dev'
    if (!IS_PACKAGED || dirty) return
    if (!process.stderr.isTTY) return
    if (argv.includes('--json')) return
    if (process.env.CI) return
    if (loadGlobalConfig().updateCheck === false) return

    const cache = readCache()
    const banner = bannerFor({
      current: HOME_VERSION,
      packaged: true,
      dirty: false,
      isTTY: true,
      json: false,
      ci: false,
      disabled: false,
      cache,
    })
    if (banner) process.stderr.write(banner + '\n')
    if (cacheIsStale(cache, Date.now())) spawnBackgroundRefresh()
  } catch {
    /* preflight must never break a command */
  }
}
