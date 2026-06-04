import type { UnifiConfig } from './client'
import { readUnifiConfig } from './client'
import { requestJson } from '../../core/http'

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

  const body = await requestJson<{ data: { id: string; name: string }[] }>(
    `${integrationBase(cfg)}/sites`,
    { headers: integrationHeaders(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )

  if (!siteIdCache) siteIdCache = new Map()
  for (const s of body.data ?? []) {
    siteIdCache.set(s.name, s.id)
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