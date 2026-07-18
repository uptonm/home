import { request, requestJson } from '../../core/http'
import { SystemError } from '../../core/errors'
import type { ModuleConfig } from '../../core/types'

export interface AssistantConfig {
  url: string
  token: string
}

export function readAssistantConfig(cfg: ModuleConfig): AssistantConfig {
  return {
    url: String(cfg.url ?? '').replace(/\/+$/, ''),
    token: String(cfg.token ?? ''),
  }
}

function headers(cfg: AssistantConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/** Auth-only headers for binary/text GETs (camera JPEG, error log) where the
 * `application/json` Accept header would be semantically wrong. */
function authHeaders(cfg: AssistantConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.token}` }
}

export async function info(cfg: AssistantConfig): Promise<{ message?: string; version?: string }> {
  return requestJson(`${cfg.url}/api/`, { headers: headers(cfg) })
}

export interface HassConfig {
  version?: string
  location_name?: string
  time_zone?: string
  components?: string[]
  unit_system?: Record<string, string>
  [k: string]: unknown
}

export async function getConfig(cfg: AssistantConfig): Promise<HassConfig> {
  return requestJson<HassConfig>(`${cfg.url}/api/config`, { headers: headers(cfg) })
}

export interface HassState {
  entity_id: string
  state: string
  attributes?: Record<string, unknown>
  last_changed?: string
  last_updated?: string
}

export async function listStates(cfg: AssistantConfig, domain?: string): Promise<HassState[]> {
  const all = await requestJson<HassState[]>(`${cfg.url}/api/states`, { headers: headers(cfg) })
  if (!domain) return all
  return all.filter((s) => s.entity_id.startsWith(`${domain}.`))
}

export async function getState(cfg: AssistantConfig, entityId: string): Promise<HassState | null> {
  const res = await request(
    `${cfg.url}/api/states/${encodeURIComponent(entityId)}`,
    { headers: headers(cfg) },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as HassState
}

export interface SearchResult {
  entity_id: string
  state: string
  friendly_name?: string
}

/**
 * Pure search over an already-fetched state list — unit-testable without
 * network access.  Search is case-insensitive substring against entity_id
 * and friendly_name.
 */
export function searchStates(states: HassState[], query: string): SearchResult[] {
  const lower = query.toLowerCase()
  return states
    .filter((s) => {
      if (s.entity_id.toLowerCase().includes(lower)) return true
      const fn = friendlyName(s)
      return typeof fn === 'string' && fn.toLowerCase().includes(lower)
    })
    .map((s) => ({
      entity_id: s.entity_id,
      state: s.state,
      friendly_name: friendlyName(s),
    }))
}

/**
 * Search entities by case-insensitive substring match against entity_id and
 * friendly_name.  When `domain` is given the search is scoped to that domain.
 */
export async function searchEntities(
  cfg: AssistantConfig,
  query: string,
  domain?: string,
): Promise<SearchResult[]> {
  const all = await listStates(cfg, domain)
  return searchStates(all, query)
}

export async function callService(
  cfg: AssistantConfig,
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<HassState[]> {
  return requestJson<HassState[]>(`${cfg.url}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(data),
  })
}

export interface ResolvedEntity {
  entity_id: string
  friendly_name?: string
}

export type ResolveResult =
  | { kind: 'ok'; entity: ResolvedEntity }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; matches: ResolvedEntity[] }

function friendlyName(state: HassState): string | undefined {
  const fn = state.attributes?.friendly_name
  return typeof fn === 'string' ? fn : undefined
}

/**
 * Pure matching core for resolveEntity — operates on an already-fetched state
 * list so the precedence rules (exact id > exact name > unique substring) can
 * be unit-tested without network access.
 */
export function matchEntity(states: HassState[], ref: string): ResolveResult {
  const lower = ref.toLowerCase()

  // 1. Exact entity_id match wins outright.
  const byId = states.find((s) => s.entity_id.toLowerCase() === lower)
  if (byId) {
    return { kind: 'ok', entity: { entity_id: byId.entity_id, friendly_name: friendlyName(byId) } }
  }

  // 2. Case-insensitive friendly_name match.
  const byName = states.filter((s) => (friendlyName(s) ?? '').toLowerCase() === lower)
  if (byName.length === 1) {
    return { kind: 'ok', entity: { entity_id: byName[0]!.entity_id, friendly_name: friendlyName(byName[0]!) } }
  }
  if (byName.length > 1) {
    return {
      kind: 'ambiguous',
      matches: byName.map((s) => ({ entity_id: s.entity_id, friendly_name: friendlyName(s) })),
    }
  }

  // 3. Substring fallback (only if unambiguous).
  const bySubstr = states.filter((s) => (friendlyName(s) ?? '').toLowerCase().includes(lower))
  if (bySubstr.length === 1) {
    return { kind: 'ok', entity: { entity_id: bySubstr[0]!.entity_id, friendly_name: friendlyName(bySubstr[0]!) } }
  }
  if (bySubstr.length > 1) {
    return {
      kind: 'ambiguous',
      matches: bySubstr.map((s) => ({ entity_id: s.entity_id, friendly_name: friendlyName(s) })),
    }
  }

  return { kind: 'not_found' }
}

/**
 * Resolve a user-supplied reference to a single entity_id. The reference may be
 * an exact entity_id (returned as-is if present) or a case-insensitive match
 * against friendly_name. When `domain` is given, only entities in that domain
 * are considered. Returns an ambiguous result (with candidates) when a
 * friendly-name match is not unique.
 */
export async function resolveEntity(
  cfg: AssistantConfig,
  ref: string,
  domain?: string,
): Promise<ResolveResult> {
  const all = await listStates(cfg, domain)
  return matchEntity(all, ref)
}

export async function history(
  cfg: AssistantConfig,
  entityId: string,
  startIso: string,
): Promise<unknown[]> {
  return requestJson<unknown[]>(
    `${cfg.url}/api/history/period/${encodeURIComponent(startIso)}?filter_entity_id=${encodeURIComponent(entityId)}`,
    { headers: headers(cfg) },
  )
}

export async function logbook(
  cfg: AssistantConfig,
  startIso: string,
  entityId?: string,
): Promise<unknown[]> {
  const qs = entityId ? `?entity=${encodeURIComponent(entityId)}` : ''
  return requestJson<unknown[]>(
    `${cfg.url}/api/logbook/${encodeURIComponent(startIso)}${qs}`,
    { headers: headers(cfg) },
  )
}

// ---------------------------------------------------------------------------
// Phase 1 — REST gap closure: services / events / calendars / template /
// camera / error-log / config / state set
// ---------------------------------------------------------------------------

export interface HassServiceDomain {
  domain: string
  services: Record<string, unknown>
}

/**
 * List every service domain and its services (with field schemas) so callers
 * can *discover* what's callable, not just call it. When `domain` is given the
 * result is scoped to that single domain.
 */
export async function listServices(
  cfg: AssistantConfig,
  domain?: string,
): Promise<HassServiceDomain[]> {
  const all = await requestJson<HassServiceDomain[]>(`${cfg.url}/api/services`, {
    headers: headers(cfg),
  })
  if (!domain) return all
  return all.filter((s) => s.domain === domain)
}

export interface HassEvent {
  event: string
  listener_count: number
}

/** List event types fired on the bus and their listener counts. */
export async function listEvents(cfg: AssistantConfig): Promise<HassEvent[]> {
  return requestJson<HassEvent[]>(`${cfg.url}/api/events`, { headers: headers(cfg) })
}

export interface HassCalendar {
  entity_id: string
  name?: string
}

/** List calendar entities. */
export async function listCalendars(cfg: AssistantConfig): Promise<HassCalendar[]> {
  const res = await request(
    `${cfg.url}/api/calendars`,
    { headers: headers(cfg) },
  )
  // HA returns 404 here when no calendar integration is loaded — that means
  // "no calendars", not an error.
  if (res.status === 404) return []
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new SystemError(
      `HTTP ${res.status} ${res.statusText} from ${cfg.url}/api/calendars${body ? `: ${body.slice(0, 200)}` : ''}`,
      `http_${res.status}`,
    )
  }
  return (await res.json()) as HassCalendar[]
}

/**
 * Fetch events for a single calendar within a [start, end] window. Both
 * timestamps are required by HA and passed as ISO-8601 query params.
 */
export async function getCalendar(
  cfg: AssistantConfig,
  entityId: string,
  startIso: string,
  endIso: string,
): Promise<unknown[]> {
  const qs = `?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`
  return requestJson<unknown[]>(
    `${cfg.url}/api/calendars/${encodeURIComponent(entityId)}${qs}`,
    { headers: headers(cfg) },
  )
}

/**
 * Render a Jinja template server-side. HA returns the rendered result as plain
 * text (not JSON), so this reads the body directly. A bad template comes back
 * as a 400 whose body carries the error — surfaced in the thrown message.
 */
export async function renderTemplate(cfg: AssistantConfig, template: string): Promise<string> {
  const res = await request(`${cfg.url}/api/template`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ template }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.text()
}

/** Grab a camera's current frame as JPEG bytes via the camera proxy. */
export async function cameraSnapshot(cfg: AssistantConfig, entityId: string): Promise<Buffer> {
  const res = await request(
    `${cfg.url}/api/camera_proxy/${encodeURIComponent(entityId)}`,
    { headers: authHeaders(cfg) },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/** Tail the controller error log (plain text). */
export async function errorLog(cfg: AssistantConfig): Promise<string> {
  const res = await request(`${cfg.url}/api/error_log`, { headers: authHeaders(cfg) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.text()
}

/**
 * Override an entity's state in HA's state machine. This is a virtual write —
 * it does NOT command the underlying device and is overwritten on the next
 * update from the owning integration. Returns the resulting state object
 * (HTTP 200 if the entity existed, 201 if newly created).
 */
export async function setState(
  cfg: AssistantConfig,
  entityId: string,
  state: string,
  attributes?: Record<string, unknown>,
): Promise<HassState> {
  const body: Record<string, unknown> = { state }
  if (attributes) body.attributes = attributes
  return requestJson<HassState>(
    `${cfg.url}/api/states/${encodeURIComponent(entityId)}`,
    { method: 'POST', headers: headers(cfg), body: JSON.stringify(body) },
  )
}
