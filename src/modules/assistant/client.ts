import { request, requestJson } from '../../core/http'
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

export async function info(cfg: AssistantConfig): Promise<{ message?: string; version?: string }> {
  return requestJson(`${cfg.url}/api/`, { headers: headers(cfg) })
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

export async function callService(
  cfg: AssistantConfig,
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  return requestJson(`${cfg.url}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(data),
  })
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
