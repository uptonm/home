import { requestJson } from '../../core/http'
import type { ModuleConfig } from '../../core/types'
import { UserError } from '../../core/errors'
import { resolveToken } from './auth'

const API_BASE = 'https://api.vercel.com'

/** Max concurrent value reads; `GET /v1/env` omits values, so each needs its own call. */
const READ_CONCURRENCY = 5

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

export async function listTeams(): Promise<Team[]> {
  const json = await requestJson<{ teams?: Team[] }>(`${API_BASE}/v2/teams`, { headers: authHeaders() })
  return json.teams ?? []
}

/** A shared environment variable as returned by the list endpoint (no value). */
export interface SharedEnvSummary {
  id: string
  key: string
  type: string
}

export async function listSharedEnv(cfg: VercelConfig): Promise<SharedEnvSummary[]> {
  const url = `${API_BASE}/v1/env?slug=${encodeURIComponent(cfg.teamSlug)}`
  const json = await requestJson<{ data?: SharedEnvSummary[] }>(url, { headers: authHeaders() })
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

export async function createSharedEnv(cfg: VercelConfig, entries: NewSharedEnv[]): Promise<void> {
  const url = `${API_BASE}/v1/env?slug=${encodeURIComponent(cfg.teamSlug)}`
  for (let i = 0; i < entries.length; i += CREATE_BATCH_MAX) {
    const batch = entries.slice(i, i + CREATE_BATCH_MAX)
    await requestJson(url, {
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
  }
}

/** Batch value update, keyed by environment variable id (not key name). */
export async function updateSharedEnv(cfg: VercelConfig, updates: Map<string, string>): Promise<void> {
  if (updates.size === 0) return
  const url = `${API_BASE}/v1/env?slug=${encodeURIComponent(cfg.teamSlug)}`
  const body: Record<string, { value: string }> = {}
  for (const [id, value] of updates) body[id] = { value }
  await requestJson(url, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ updates: body }),
  })
}
