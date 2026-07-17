import { requestJson } from '../../core/http'
import type { ModuleConfig } from '../../core/types'
import { SystemError, UserError } from '../../core/errors'
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
}

export function readVercelConfig(cfg: ModuleConfig): VercelConfig {
  const teamSlug = String(cfg.teamSlug ?? '').trim()
  if (!teamSlug) throw new UserError('teamSlug is not set — run `home vercel configure`', 'vercel_no_team')
  return { teamSlug }
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
 * `HOME__*`). The endpoint's response is paginated but exposes no request
 * parameter to fetch further pages, so if more than one page of HOME__ keys
 * ever exists we must refuse: treating page one as the full set would make
 * `pull` silently skip keys and `push` try to re-create ones that exist.
 */
export async function listSharedEnv(cfg: VercelConfig): Promise<SharedEnvSummary[]> {
  const url = `${API_BASE}/v1/env?slug=${encodeURIComponent(cfg.teamSlug)}&search=${encodeURIComponent(KEY_PREFIX)}`
  const json = await requestJson<{ data?: SharedEnvSummary[]; pagination?: Pagination }>(url, {
    headers: authHeaders(),
  })
  if (json.pagination?.next != null) {
    throw new SystemError(
      'shared environment variable list is paginated beyond one page — refusing to sync from an incomplete list',
      'vercel_env_paginated',
    )
  }
  return json.data ?? []
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
