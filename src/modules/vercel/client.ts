import { request, requestJson } from '../../core/http'
import type { ModuleConfig } from '../../core/types'
import { HomeError, SystemError, UserError } from '../../core/errors'
import { resolveToken } from './auth'

const API_BASE = 'https://api.vercel.com'

/** Max concurrent value reads; `GET /v1/env` omits values, so each needs its own call. */
const READ_CONCURRENCY = 5

/**
 * Prefix marking a shared env var as owned by this CLI. Anything without it is
 * someone else's variable and is never read, written, or reported. Lives here
 * (not sync.ts) because the client filters requests by it and sync imports the
 * registry — the reverse import would be a cycle.
 */
export const KEY_PREFIX = 'HOME__'

export interface VercelConfig {
  teamSlug: string
  /** Project whose newest production deployment `status` reports. Optional. */
  defaultProject?: string
}

export function readVercelConfig(cfg: ModuleConfig): VercelConfig {
  const teamSlug = String(cfg.teamSlug ?? '').trim()
  if (!teamSlug) throw new UserError('teamSlug is not set — run `home vercel configure`', 'vercel_no_team')
  const defaultProject = String(cfg.defaultProject ?? '').trim()
  return { teamSlug, defaultProject: defaultProject || undefined }
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${resolveToken()}`, 'Content-Type': 'application/json' }
}

export interface Team {
  id: string
  slug: string
  name: string | null
}

interface Pagination {
  count?: number
  next?: number | null
  prev?: number | null
}

/** Hard cap on pagination loops so a misbehaving API can't spin forever. */
const MAX_PAGES = 20

export async function listTeams(): Promise<Team[]> {
  const teams: Team[] = []
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ limit: '100' })
    if (until !== undefined) qs.set('until', String(until))
    const json = await requestJson<{ teams?: Team[]; pagination?: Pagination }>(
      `${API_BASE}/v2/teams?${qs}`,
      { headers: authHeaders() },
    )
    teams.push(...(json.teams ?? []))
    const next = json.pagination?.next
    if (next == null) return teams
    until = next
  }
  throw new SystemError(`gave up paging /v2/teams after ${MAX_PAGES} pages`, 'vercel_pagination')
}

/** A shared environment variable as returned by the list endpoint (no value). */
export interface SharedEnvSummary {
  id: string
  key: string
  type: string
}

/**
 * List this CLI's shared environment variables (server-side filtered to
 * `HOME__*`), paging through every result. `pagination.next` is a cursor
 * echoed back as `until`, uniform with the rest of the Vercel API — see
 * `listTeams`. A partial list would make `pull` silently skip keys and `push`
 * try to re-create ones that already exist, so we must exhaust the pages.
 */
export async function listSharedEnv(cfg: VercelConfig): Promise<SharedEnvSummary[]> {
  const out: SharedEnvSummary[] = []
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ slug: cfg.teamSlug, search: KEY_PREFIX, limit: '100' })
    if (until !== undefined) qs.set('until', String(until))
    const json = await requestJson<{ data?: SharedEnvSummary[]; pagination?: Pagination }>(
      `${API_BASE}/v1/env?${qs}`,
      { headers: authHeaders() },
    )
    out.push(...(json.data ?? []))
    const next = json.pagination?.next
    if (next == null) return out
    until = next
  }
  throw new SystemError(`gave up paging /v1/env after ${MAX_PAGES} pages`, 'vercel_pagination')
}

/**
 * Fetch one variable's decrypted value. The list endpoint always returns
 * `value: null` (even with `decrypt=true`); only the by-id endpoint decrypts,
 * and only for `type: "encrypted"` — `sensitive` values are never readable,
 * which is why `push` always writes `encrypted`.
 */
export async function getSharedEnvValue(cfg: VercelConfig, id: string): Promise<string | null> {
  const url = `${API_BASE}/v1/env/${encodeURIComponent(id)}?slug=${encodeURIComponent(cfg.teamSlug)}`
  const json = await requestJson<{ value?: string | null; decrypted?: boolean }>(url, { headers: authHeaders() })
  return json.value ?? null
}

/** Resolve values for many variables, bounded so a large sync can't fan out unbounded. */
export async function getSharedEnvValues(
  cfg: VercelConfig,
  entries: SharedEnvSummary[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < entries.length) {
      const entry = entries[cursor++]!
      const value = await getSharedEnvValue(cfg, entry.id)
      if (value !== null) out.set(entry.key, value)
    }
  }
  const workers = Array.from({ length: Math.min(READ_CONCURRENCY, entries.length) }, worker)
  await Promise.all(workers)
  return out
}

export interface NewSharedEnv {
  key: string
  value: string
  comment: string
}

/** Max `evs` accepted by a single POST /v1/env. */
const CREATE_BATCH_MAX = 50

/**
 * Per-entry failure as returned inside a 2xx batch response. Verified live:
 * the failing key name is in `error.envVarKey` (`error.key` is the name of the
 * offending request *field*, literally "key").
 */
interface BatchFailure {
  error?: { code?: string; message?: string; envVarKey?: string; id?: string }
}

/**
 * Batch create/update returns 2xx even when individual entries fail, with the
 * casualties in a `failed` array. Renders key names and error text only —
 * never values, several of which are secrets. Returns null when nothing failed.
 */
export function batchFailureMessage(failed: BatchFailure[] | undefined, idToKey?: Map<string, string>): string | null {
  if (!failed || failed.length === 0) return null
  const parts = failed.map((f) => {
    const key = f.error?.envVarKey ?? (f.error?.id ? (idToKey?.get(f.error.id) ?? f.error.id) : 'unknown')
    const why = f.error?.message ?? f.error?.code ?? 'unknown error'
    return `${key}: ${why}`
  })
  return `${failed.length} entr${failed.length === 1 ? 'y' : 'ies'} failed — ${parts.join('; ')}`
}

export async function createSharedEnv(cfg: VercelConfig, entries: NewSharedEnv[]): Promise<void> {
  const url = `${API_BASE}/v1/env?slug=${encodeURIComponent(cfg.teamSlug)}`
  for (let i = 0; i < entries.length; i += CREATE_BATCH_MAX) {
    const batch = entries.slice(i, i + CREATE_BATCH_MAX)
    const json = await requestJson<{ created?: unknown[]; failed?: BatchFailure[] }>(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        evs: batch,
        // `encrypted` (not `sensitive`) so the value can be read back; `development`
        // because the Vercel API rejects `sensitive` there, guaranteeing readability.
        type: 'encrypted',
        target: ['development'],
        // Unlinked: shared env vars live at the team level and need no project.
        projectIds: [],
      }),
    })
    const failure = batchFailureMessage(json.failed)
    if (failure) throw new SystemError(`create shared env: ${failure}`, 'vercel_env_create_failed')
  }
}

export interface SharedEnvUpdate {
  id: string
  /** Key name, carried alongside the id so failures can be reported by name. */
  key: string
  value: string
}

export async function updateSharedEnv(cfg: VercelConfig, updates: SharedEnvUpdate[]): Promise<void> {
  if (updates.length === 0) return
  const url = `${API_BASE}/v1/env?slug=${encodeURIComponent(cfg.teamSlug)}`
  const body: Record<string, { value: string }> = {}
  const idToKey = new Map<string, string>()
  for (const u of updates) {
    body[u.id] = { value: u.value }
    idToKey.set(u.id, u.key)
  }
  const json = await requestJson<{ updated?: unknown[]; failed?: BatchFailure[] }>(url, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ updates: body }),
  })
  const failure = batchFailureMessage(json.failed, idToKey)
  if (failure) throw new SystemError(`update shared env: ${failure}`, 'vercel_env_update_failed')
}

// ── Read spine: projects, deployments, domains ──────────────────────────────
//
// API versions in use (per https://vercel.com/docs/rest-api, verified live):
//   GET /v9/projects                      list + get by id/name
//   GET /v9/projects/{id}/domains         project domains
//   GET /v6/deployments                   list
//   GET /v13/deployments/{id|url}         get by id or hostname
//   GET /v3/deployments/{id|url}/events   build/deployment events
//   GET /v5/domains                       team domains
//   GET /v6/domains/{name}/config         DNS configuration

/** Strip a known token out of text before it can reach a terminal or log. */
export function redactToken(text: string): string {
  let token: string
  try {
    token = resolveToken()
  } catch {
    return text
  }
  return token ? text.split(token).join('[redacted]') : text
}

interface VercelErrorBody {
  error?: { code?: string; message?: string }
}

async function normalizeApiError(res: Response, path: string): Promise<HomeError> {
  const body = (await res.json().catch(() => null)) as VercelErrorBody | null
  const detail = redactToken(body?.error?.message ?? `HTTP ${res.status} ${res.statusText}`)
  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after')
    return new SystemError(
      `Vercel rate limit hit on ${path}${retryAfter ? ` — retry after ${retryAfter}s` : ''}: ${detail}`,
      'vercel_rate_limited',
    )
  }
  const code = body?.error?.code ? `vercel_${body.error.code}` : `vercel_http_${res.status}`
  if (res.status >= 400 && res.status < 500) return new UserError(`${detail} (${path})`, code)
  return new SystemError(`${detail} (${path})`, code)
}

/** GET a Vercel API path scoped to the configured team, with normalized errors. */
async function vercelGet<T>(cfg: VercelConfig, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ slug: cfg.teamSlug, ...params })
  const res = await request(`${API_BASE}${path}?${qs}`, { headers: authHeaders() })
  if (!res.ok) throw await normalizeApiError(res, path)
  return (await res.json()) as T
}

export const DEPLOYMENT_STATES = ['queued', 'building', 'ready', 'error', 'canceled'] as const
export type DeploymentState = (typeof DEPLOYMENT_STATES)[number] | 'unknown'

const RAW_STATE_TO_NORMALIZED: Record<string, DeploymentState> = {
  QUEUED: 'queued',
  INITIALIZING: 'building',
  BUILDING: 'building',
  READY: 'ready',
  ERROR: 'error',
  CANCELED: 'canceled',
}

export function normalizeDeploymentState(raw: string | undefined): DeploymentState {
  if (!raw) return 'unknown'
  return RAW_STATE_TO_NORMALIZED[raw.toUpperCase()] ?? 'unknown'
}

/** The raw `state=` filter values behind each normalized state name. */
const NORMALIZED_STATE_TO_FILTER: Record<string, string> = {
  queued: 'QUEUED',
  building: 'BUILDING,INITIALIZING',
  ready: 'READY',
  error: 'ERROR',
  canceled: 'CANCELED',
}

export function toIso(epochMs: number | null | undefined): string | null {
  return typeof epochMs === 'number' ? new Date(epochMs).toISOString() : null
}

interface RawGitLink {
  type?: string
  org?: string
  repo?: string
  projectNamespace?: string
  projectName?: string
  owner?: string
  slug?: string
  productionBranch?: string
}

/** Collapse the provider-specific link shapes into one `type:owner/repo` string. */
function repoFromLink(link: RawGitLink | undefined): string | null {
  if (!link) return null
  const owner = link.org ?? link.projectNamespace ?? link.owner
  const name = link.repo ?? link.projectName ?? link.slug
  if (!owner || !name) return null
  return `${link.type ?? 'git'}:${owner}/${name}`
}

interface RawTargetDeployment {
  id?: string
  readyState?: string
  url?: string
  alias?: string[]
  createdAt?: number
}

interface RawProject {
  id: string
  name: string
  framework?: string | null
  link?: RawGitLink
  updatedAt?: number
  targets?: { production?: RawTargetDeployment | null; preview?: RawTargetDeployment | null }
}

export interface ProjectSummary {
  id: string
  name: string
  framework: string | null
  repo: string | null
  updatedAt: string | null
}

function toProjectSummary(p: RawProject): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    framework: p.framework ?? null,
    repo: repoFromLink(p.link),
    updatedAt: toIso(p.updatedAt),
  }
}

async function pageProjects(cfg: VercelConfig, limit: number, onPage: (projects: RawProject[]) => boolean): Promise<void> {
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { limit: String(Math.min(limit, 100)) }
    if (until !== undefined) params.until = String(until)
    const json = await vercelGet<{ projects?: RawProject[]; pagination?: Pagination }>(cfg, '/v9/projects', params)
    const done = onPage(json.projects ?? [])
    const next = json.pagination?.next
    if (done || next == null) return
    until = next
  }
  throw new SystemError(`gave up paging /v9/projects after ${MAX_PAGES} pages`, 'vercel_pagination')
}

export async function listProjects(cfg: VercelConfig, limit: number): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = []
  await pageProjects(cfg, limit, (projects) => {
    for (const p of projects) out.push(toProjectSummary(p))
    return out.length >= limit
  })
  return out.slice(0, limit)
}

export interface TargetSummary {
  deploymentId: string | null
  state: DeploymentState
  url: string | null
  createdAt: string | null
}

function toTargetSummary(t: RawTargetDeployment | null | undefined): TargetSummary | null {
  if (!t) return null
  return {
    deploymentId: t.id ?? null,
    state: normalizeDeploymentState(t.readyState),
    url: t.url ?? null,
    createdAt: toIso(t.createdAt),
  }
}

export interface ProjectDetail extends ProjectSummary {
  productionBranch: string | null
  targets: { production: TargetSummary | null; preview: TargetSummary | null }
  domains: ProjectDomain[]
}

export async function getProject(cfg: VercelConfig, idOrName: string): Promise<ProjectDetail> {
  const raw = await vercelGet<RawProject>(cfg, `/v9/projects/${encodeURIComponent(idOrName)}`)
  const domains = await listProjectDomains(cfg, raw.id, 100)
  return {
    ...toProjectSummary(raw),
    productionBranch: raw.link?.productionBranch ?? null,
    targets: {
      production: toTargetSummary(raw.targets?.production),
      preview: toTargetSummary(raw.targets?.preview),
    },
    domains,
  }
}

export interface DeploymentCommit {
  sha: string
  message: string | null
  ref: string | null
}

/** The commit meta keys are provider-prefixed (githubCommitSha, gitlabCommitSha, …). */
function commitFromMeta(meta: Record<string, string> | undefined): DeploymentCommit | null {
  if (!meta) return null
  for (const provider of ['github', 'gitlab', 'bitbucket']) {
    const sha = meta[`${provider}CommitSha`]
    if (sha) {
      return {
        sha,
        message: meta[`${provider}CommitMessage`] ?? null,
        ref: meta[`${provider}CommitRef`] ?? null,
      }
    }
  }
  return null
}

interface RawDeploymentSummary {
  uid: string
  name?: string
  url?: string | null
  readyState?: string
  state?: string
  target?: string | null
  projectId?: string
  meta?: Record<string, string>
  creator?: { username?: string; email?: string }
  createdAt?: number
  created?: number
}

export interface DeploymentSummary {
  id: string
  project: string | null
  projectId: string | null
  url: string | null
  state: DeploymentState
  target: string | null
  commit: DeploymentCommit | null
  creator: string | null
  createdAt: string | null
}

function toDeploymentSummary(d: RawDeploymentSummary): DeploymentSummary {
  return {
    id: d.uid,
    project: d.name ?? null,
    projectId: d.projectId ?? null,
    url: d.url ?? null,
    state: normalizeDeploymentState(d.readyState ?? d.state),
    target: d.target ?? null,
    commit: commitFromMeta(d.meta),
    creator: d.creator?.username ?? d.creator?.email ?? null,
    createdAt: toIso(d.createdAt ?? d.created),
  }
}

export interface ListDeploymentsOptions {
  /** Project id (`prj_…`) or name. */
  project?: string
  /** Deployment target: production, preview, or a custom environment name. */
  target?: string
  /** Normalized state filter. */
  state?: string
  limit: number
}

export async function listDeployments(cfg: VercelConfig, opts: ListDeploymentsOptions): Promise<DeploymentSummary[]> {
  const base: Record<string, string> = {}
  if (opts.project) base[opts.project.startsWith('prj_') ? 'projectId' : 'app'] = opts.project
  if (opts.target) base.target = opts.target
  if (opts.state) {
    const filter = NORMALIZED_STATE_TO_FILTER[opts.state]
    if (!filter) {
      throw new UserError(`unknown state "${opts.state}" — expected one of ${DEPLOYMENT_STATES.join(', ')}`, 'vercel_bad_state')
    }
    base.state = filter
  }

  const out: DeploymentSummary[] = []
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { ...base, limit: String(Math.min(opts.limit, 100)) }
    if (until !== undefined) params.until = String(until)
    const json = await vercelGet<{ deployments?: RawDeploymentSummary[]; pagination?: Pagination }>(
      cfg,
      '/v6/deployments',
      params,
    )
    for (const d of json.deployments ?? []) out.push(toDeploymentSummary(d))
    const next = json.pagination?.next
    if (out.length >= opts.limit || next == null) return out.slice(0, opts.limit)
    until = next
  }
  throw new SystemError(`gave up paging /v6/deployments after ${MAX_PAGES} pages`, 'vercel_pagination')
}

/**
 * The by-id endpoint accepts either a deployment id (`dpl_…`) or its bare
 * hostname — but not a full URL, so strip scheme and path if given one.
 */
export function deploymentPathSegment(idOrUrl: string): string {
  return idOrUrl
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
}

interface RawDeploymentDetail {
  id: string
  name?: string
  url?: string | null
  readyState?: string
  readySubstate?: string
  target?: string | null
  alias?: string[]
  automaticAliases?: string[]
  gitSource?: { sha?: string; ref?: string }
  meta?: Record<string, string>
  creator?: { username?: string; email?: string }
  createdAt?: number
  buildingAt?: number
  ready?: number
  inspectorUrl?: string | null
}

export interface DeploymentDetail {
  id: string
  project: string | null
  url: string | null
  state: DeploymentState
  readySubstate: string | null
  target: string | null
  aliases: string[]
  commit: DeploymentCommit | null
  creator: string | null
  timing: { createdAt: string | null; buildingAt: string | null; ready: string | null }
  inspectorUrl: string | null
}

export async function getDeployment(cfg: VercelConfig, idOrUrl: string): Promise<DeploymentDetail> {
  const raw = await vercelGet<RawDeploymentDetail>(
    cfg,
    `/v13/deployments/${encodeURIComponent(deploymentPathSegment(idOrUrl))}`,
  )
  const commitFromGit = raw.gitSource?.sha
    ? {
        sha: raw.gitSource.sha,
        message: commitFromMeta(raw.meta)?.message ?? null,
        ref: raw.gitSource.ref ?? null,
      }
    : commitFromMeta(raw.meta)
  return {
    id: raw.id,
    project: raw.name ?? null,
    url: raw.url ?? null,
    state: normalizeDeploymentState(raw.readyState),
    readySubstate: raw.readySubstate ?? null,
    target: raw.target ?? null,
    aliases: raw.alias ?? [],
    commit: commitFromGit,
    creator: raw.creator?.username ?? raw.creator?.email ?? null,
    timing: {
      createdAt: toIso(raw.createdAt),
      buildingAt: toIso(raw.buildingAt),
      ready: toIso(raw.ready),
    },
    inspectorUrl: raw.inspectorUrl ?? null,
  }
}

interface RawDeploymentEvent {
  type?: string
  created?: number
  date?: number
  text?: string
  payload?: { text?: string }
}

export interface DeploymentEvent {
  type: string
  created: string | null
  text: string | null
}

export async function listDeploymentEvents(cfg: VercelConfig, idOrUrl: string, limit: number): Promise<DeploymentEvent[]> {
  const raw = await vercelGet<RawDeploymentEvent[] | unknown>(
    cfg,
    `/v3/deployments/${encodeURIComponent(deploymentPathSegment(idOrUrl))}/events`,
    { limit: String(limit) },
  )
  const events = Array.isArray(raw) ? (raw as RawDeploymentEvent[]) : []
  return events.slice(0, limit).map((e) => ({
    type: e.type ?? 'unknown',
    created: toIso(e.created ?? e.date),
    text: e.text ?? e.payload?.text ?? null,
  }))
}

interface RawTeamDomain {
  name: string
  verified?: boolean
  serviceType?: string
  createdAt?: number
  expiresAt?: number | null
}

export interface TeamDomainSummary {
  name: string
  verified: boolean
  serviceType: string | null
  createdAt: string | null
  expiresAt: string | null
}

/** Domains registered with (or transferred into) the team itself. */
export async function listTeamDomains(cfg: VercelConfig, limit: number): Promise<TeamDomainSummary[]> {
  const out: TeamDomainSummary[] = []
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { limit: String(Math.min(limit, 100)) }
    if (until !== undefined) params.until = String(until)
    const json = await vercelGet<{ domains?: RawTeamDomain[]; pagination?: Pagination }>(cfg, '/v5/domains', params)
    for (const d of json.domains ?? []) {
      out.push({
        name: d.name,
        verified: d.verified ?? false,
        serviceType: d.serviceType ?? null,
        createdAt: toIso(d.createdAt),
        expiresAt: toIso(d.expiresAt),
      })
    }
    const next = json.pagination?.next
    if (out.length >= limit || next == null) return out.slice(0, limit)
    until = next
  }
  throw new SystemError(`gave up paging /v5/domains after ${MAX_PAGES} pages`, 'vercel_pagination')
}

interface RawProjectDomain {
  name: string
  apexName?: string
  projectId?: string
  verified?: boolean
  redirect?: string | null
  gitBranch?: string | null
  updatedAt?: number
}

export interface ProjectDomain {
  name: string
  apexName: string | null
  projectId: string | null
  verified: boolean
  redirect: string | null
  gitBranch: string | null
  updatedAt: string | null
}

function toProjectDomain(d: RawProjectDomain): ProjectDomain {
  return {
    name: d.name,
    apexName: d.apexName ?? null,
    projectId: d.projectId ?? null,
    verified: d.verified ?? false,
    redirect: d.redirect ?? null,
    gitBranch: d.gitBranch ?? null,
    updatedAt: toIso(d.updatedAt),
  }
}

export async function listProjectDomains(cfg: VercelConfig, project: string, limit: number): Promise<ProjectDomain[]> {
  const path = `/v9/projects/${encodeURIComponent(project)}/domains`
  const out: ProjectDomain[] = []
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { limit: String(Math.min(limit, 100)) }
    if (until !== undefined) params.until = String(until)
    const json = await vercelGet<{ domains?: RawProjectDomain[]; pagination?: Pagination }>(cfg, path, params)
    for (const d of json.domains ?? []) out.push(toProjectDomain(d))
    const next = json.pagination?.next
    if (out.length >= limit || next == null) return out.slice(0, limit)
    until = next
  }
  throw new SystemError(`gave up paging ${path} after ${MAX_PAGES} pages`, 'vercel_pagination')
}

export interface DomainConfig {
  configuredBy: string | null
  misconfigured: boolean
  serviceType: string | null
  nameservers: string[]
  aValues: string[]
  cnames: string[]
  acceptedChallenges: string[]
}

export async function getDomainConfig(cfg: VercelConfig, name: string): Promise<DomainConfig> {
  const raw = await vercelGet<Partial<DomainConfig>>(cfg, `/v6/domains/${encodeURIComponent(name)}/config`)
  return {
    configuredBy: raw.configuredBy ?? null,
    misconfigured: raw.misconfigured ?? false,
    serviceType: raw.serviceType ?? null,
    nameservers: raw.nameservers ?? [],
    aValues: raw.aValues ?? [],
    cnames: raw.cnames ?? [],
    acceptedChallenges: raw.acceptedChallenges ?? [],
  }
}

export interface DomainOwner {
  projectId: string
  projectName: string
  /**
   * Coverage of the resolved match: only production aliases are scanned, so a
   * domain attached to a preview/gitBranch deployment or a project with no
   * production deployment is invisible here and reads as unowned.
   */
  ownerLookup: 'production-alias'
}

/**
 * No read endpoint maps a domain to its project, but each project's production
 * target lists every alias assigned to it — so scan the (paged) project list.
 * A full per-project domain scan would honor preview/gitBranch attachments too,
 * at the cost of a rate-limited call per project; production aliases are the
 * documented coverage instead.
 */
export async function findDomainOwner(cfg: VercelConfig, name: string): Promise<DomainOwner | null> {
  const needle = name.toLowerCase()
  let owner: DomainOwner | null = null
  await pageProjects(cfg, 100, (projects) => {
    for (const p of projects) {
      const aliases = p.targets?.production?.alias ?? []
      if (aliases.some((a) => a.toLowerCase() === needle)) {
        owner = { projectId: p.id, projectName: p.name, ownerLookup: 'production-alias' }
        return true
      }
    }
    return false
  })
  return owner
}

export async function getProjectDomain(cfg: VercelConfig, project: string, name: string): Promise<ProjectDomain> {
  const raw = await vercelGet<RawProjectDomain>(
    cfg,
    `/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(name)}`,
  )
  return toProjectDomain(raw)
}
