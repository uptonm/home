import type { UnifiConfig } from './client'
import { readUnifiConfig } from './client'
import { request, requestJson } from '../../core/http'
import { SystemError } from '../../core/errors'

// ── Integration API client ────────────────────────────────────────────────
// Official UniFi Network Integration API (v9.x+)
// Base: /proxy/network/integration/v1
// Auth: X-API-KEY header (same key as the private API)

const integrationBase = (cfg: UnifiConfig) =>
  `${cfg.url}/proxy/network/integration/v1`

const integrationHeaders = (cfg: UnifiConfig): Record<string, string> => ({
  'X-API-KEY': cfg.apiKey,
  Accept: 'application/json',
})

/** Memoized site-name → integration siteId mapping. */
let siteIdCache: Map<string, string> | null = null

/** Resolve the integration API siteId from the configured site name. */
export async function resolveIntegrationSiteId(cfg: UnifiConfig): Promise<string> {
  if (siteIdCache?.has(cfg.site)) return siteIdCache.get(cfg.site)!

  const body = await requestJson<{ data: { id: string; name: string; internalReference?: string }[] }>(
    `${integrationBase(cfg)}/sites`,
    { headers: integrationHeaders(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )

  if (!siteIdCache) siteIdCache = new Map()
  for (const s of body.data ?? []) {
    // The classic API's site name (config's `site`) is the integration API's
    // internalReference; `name` is the display name ("default" vs "Default").
    siteIdCache.set(s.name, s.id)
    if (s.internalReference) siteIdCache.set(s.internalReference, s.id)
  }
  const id = siteIdCache.get(cfg.site)
  if (!id) throw Object.assign(new Error(`site "${cfg.site}" not found in integration API`), { code: 'site_not_found' })
  return id
}

/** Probe the integration API — returns version info or null if unreachable. */
export async function integrationAppInfo(cfg: UnifiConfig): Promise<{ version: string; uuid: string } | null> {
  try {
    const body = await requestJson<{ server_version: string; uuid: string }>(
      `${integrationBase(cfg)}/info`,
      { headers: integrationHeaders(cfg) },
      { insecureTLS: cfg.insecureTLS },
    )
    return body.server_version ? { version: body.server_version, uuid: body.uuid } : null
  } catch {
    return null
  }
}

// ── Pagination helper ─────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[]
  offset: number
  limit: number
  totalCount: number
}

export async function paginate<T>(
  cfg: UnifiConfig,
  path: string,
  limit = 100,
): Promise<T[]> {
  const results: T[] = []
  let offset = 0
  while (true) {
    const url = `${integrationBase(cfg)}${path}?offset=${offset}&limit=${limit}`
    const body = await requestJson<PaginatedResponse<T>>(
      url,
      { headers: integrationHeaders(cfg) },
      { insecureTLS: cfg.insecureTLS },
    )
    results.push(...(body.data ?? []))
    if (offset + limit >= body.totalCount) break
    offset += limit
  }
  return results
}

// ── Source selection ──────────────────────────────────────────────────────

export type UniFiSource = 'auto' | 'network' | 'integration'

export function effectiveSource(cfg: UnifiConfig): UniFiSource {
  return (cfg as any).source ?? 'auto'
}

/** Run a network-API function, optionally falling back to integration. */
export async function withSource<T>(
  cfg: UnifiConfig,
  networkFn: () => Promise<T>,
  integrationFn: () => Promise<T>,
): Promise<T> {
  const source = effectiveSource(cfg)
  if (source === 'integration') return integrationFn()
  try {
    return await networkFn()
  } catch (e: any) {
    if (source === 'network') throw e
    // auto mode: fall back on auth errors / not found
    if (e?.code === 'http_401' || e?.code === 'http_403' || e?.code === 'http_404') {
      return integrationFn()
    }
    throw e
  }
}

// ── Integration device/client wrappers ────────────────────────────────────

export async function integrationListDevices(cfg: UnifiConfig): Promise<unknown[]> {
  const siteId = await resolveIntegrationSiteId(cfg)
  return paginate(cfg, `/sites/${encodeURIComponent(siteId)}/devices`)
}

export async function integrationGetDevice(cfg: UnifiConfig, id: string): Promise<unknown | null> {
  const siteId = await resolveIntegrationSiteId(cfg)
  const body = await requestJson<{ data: unknown }>(
    `${integrationBase(cfg)}/sites/${encodeURIComponent(siteId)}/devices/${encodeURIComponent(id)}`,
    { headers: integrationHeaders(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? null
}

export async function integrationListClients(cfg: UnifiConfig): Promise<unknown[]> {
  const siteId = await resolveIntegrationSiteId(cfg)
  return paginate(cfg, `/sites/${encodeURIComponent(siteId)}/clients`)
}

export async function integrationGetClient(cfg: UnifiConfig, id: string): Promise<unknown | null> {
  const siteId = await resolveIntegrationSiteId(cfg)
  const body = await requestJson<{ data: unknown }>(
    `${integrationBase(cfg)}/sites/${encodeURIComponent(siteId)}/clients/${encodeURIComponent(id)}`,
    { headers: integrationHeaders(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? null
}

export async function integrationListSites(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${integrationBase(cfg)}/sites`,
    { headers: integrationHeaders(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function integrationGetDeviceStats(cfg: UnifiConfig, id: string): Promise<unknown | null> {
  const siteId = await resolveIntegrationSiteId(cfg)
  try {
    const body = await requestJson<{ data: unknown }>(
      `${integrationBase(cfg)}/sites/${encodeURIComponent(siteId)}/devices/${encodeURIComponent(id)}/statistics/latest`,
      { headers: integrationHeaders(cfg) },
      { insecureTLS: cfg.insecureTLS },
    )
    return body.data ?? null
  } catch {
    return null
  }
}

// ── Write helper (POST / DELETE) ──────────────────────────────────────────
// The integration API returns a JSON envelope on most writes, but DELETE (and
// some actions) may reply 204/empty — tolerate that instead of letting
// res.json() throw. Errors surface with an `http_<status>` code so they read
// cleanly and so withSource() can detect 401/403/404 for fallback.

async function integrationMutate<T = unknown>(
  cfg: UnifiConfig,
  path: string,
  method: 'POST' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<T | null> {
  const res = await request(
    `${integrationBase(cfg)}${path}`,
    {
      method,
      headers: {
        ...integrationHeaders(cfg),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { insecureTLS: cfg.insecureTLS },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new SystemError(
      `HTTP ${res.status} ${res.statusText} from integration API${text ? `: ${text.slice(0, 200)}` : ''}`,
      `http_${res.status}`,
    )
  }
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

// ── Vouchers (integration-only) ───────────────────────────────────────────

export interface VoucherCreateOptions {
  /** How many vouchers to mint in this batch (defaults to 1). */
  count?: number
  /** Free-text note attached to the batch. */
  name?: string
  /** Validity window in minutes (the API's timeLimitMinutes). */
  timeLimitMinutes?: number
  /** Max number of devices that may redeem each voucher (authorizedGuestLimit). */
  authorizedGuestLimit?: number
}

export async function integrationListVouchers(cfg: UnifiConfig): Promise<unknown[]> {
  const siteId = await resolveIntegrationSiteId(cfg)
  return paginate(cfg, `/sites/${encodeURIComponent(siteId)}/hotspot/vouchers`)
}

export async function integrationGetVoucher(cfg: UnifiConfig, id: string): Promise<unknown | null> {
  const siteId = await resolveIntegrationSiteId(cfg)
  try {
    const body = await requestJson<{ data: unknown }>(
      `${integrationBase(cfg)}/sites/${encodeURIComponent(siteId)}/hotspot/vouchers/${encodeURIComponent(id)}`,
      { headers: integrationHeaders(cfg) },
      { insecureTLS: cfg.insecureTLS },
    )
    return body.data ?? null
  } catch (e: any) {
    if (e?.code === 'http_404') return null
    throw e
  }
}

export async function integrationCreateVouchers(
  cfg: UnifiConfig,
  options: VoucherCreateOptions,
): Promise<unknown> {
  const siteId = await resolveIntegrationSiteId(cfg)
  const body: Record<string, unknown> = { count: options.count ?? 1 }
  if (options.name !== undefined) body.name = options.name
  if (options.timeLimitMinutes !== undefined) body.timeLimitMinutes = options.timeLimitMinutes
  if (options.authorizedGuestLimit !== undefined) body.authorizedGuestLimit = options.authorizedGuestLimit
  return integrationMutate(cfg, `/sites/${encodeURIComponent(siteId)}/hotspot/vouchers`, 'POST', body)
}

export async function integrationDeleteVoucher(cfg: UnifiConfig, id: string): Promise<unknown> {
  const siteId = await resolveIntegrationSiteId(cfg)
  return integrationMutate(
    cfg,
    `/sites/${encodeURIComponent(siteId)}/hotspot/vouchers/${encodeURIComponent(id)}`,
    'DELETE',
  )
}

// ── Device / client actions (integration-only) ────────────────────────────
// The integration `id` matches the private API `_id` for both devices and
// clients, so callers resolve a friendly ref → `_id` via the private list and
// pass it straight through (same assumption integrationGetDeviceStats relies on).

export async function integrationDeviceAction(
  cfg: UnifiConfig,
  deviceId: string,
  action: string,
): Promise<unknown> {
  const siteId = await resolveIntegrationSiteId(cfg)
  return integrationMutate(
    cfg,
    `/sites/${encodeURIComponent(siteId)}/devices/${encodeURIComponent(deviceId)}/actions`,
    'POST',
    { action },
  )
}

export async function integrationPortAction(
  cfg: UnifiConfig,
  deviceId: string,
  portIdx: number,
  action: string,
): Promise<unknown> {
  const siteId = await resolveIntegrationSiteId(cfg)
  return integrationMutate(
    cfg,
    `/sites/${encodeURIComponent(siteId)}/devices/${encodeURIComponent(deviceId)}/interfaces/ports/${encodeURIComponent(String(portIdx))}/actions`,
    'POST',
    { action },
  )
}

export async function integrationClientAction(
  cfg: UnifiConfig,
  clientId: string,
  action: string,
  extra?: Record<string, unknown>,
): Promise<unknown> {
  const siteId = await resolveIntegrationSiteId(cfg)
  return integrationMutate(
    cfg,
    `/sites/${encodeURIComponent(siteId)}/clients/${encodeURIComponent(clientId)}/actions`,
    'POST',
    { action, ...(extra ?? {}) },
  )
}
