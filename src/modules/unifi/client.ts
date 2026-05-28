import { requestJson } from '../../core/http'
import type { ModuleConfig } from '../../core/types'

export interface UnifiConfig {
  url: string
  site: string
  apiKey: string
  insecureTLS?: boolean
}

export function readUnifiConfig(cfg: ModuleConfig): UnifiConfig {
  return {
    url: String(cfg.url ?? '').replace(/\/+$/, ''),
    site: String(cfg.site ?? 'default'),
    apiKey: String(cfg.apiKey ?? ''),
    insecureTLS: Boolean(cfg.insecureTLS),
  }
}

function headers(cfg: UnifiConfig): Record<string, string> {
  return {
    'X-API-KEY': cfg.apiKey,
    Accept: 'application/json',
  }
}

export async function listSites(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/self/sites`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listDevices(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/device`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function getDevice(cfg: UnifiConfig, mac: string): Promise<unknown | null> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/device/${encodeURIComponent(mac)}`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data?.[0] ?? null
}

export async function listClients(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/sta`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function siteHealth(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/health`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function siteInfo(cfg: UnifiConfig): Promise<unknown | null> {
  const sites = await listSites(cfg)
  return (sites as { name?: string }[]).find((s) => s.name === cfg.site) ?? null
}
