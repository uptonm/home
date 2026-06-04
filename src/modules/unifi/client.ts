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

export async function listNetworks(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/networkconf`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export interface NetworkRef {
  _id?: string
  name?: string
  vlan?: number
}

export type ResolveNetworkResult<T extends NetworkRef> =
  | { kind: 'ok'; network: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; matches: T[] }

/**
 * Resolve a network by name, _id, or VLAN id. Pure + synchronous so it can be
 * unit-tested without hitting the controller. Resolution order:
 *   1. exact _id
 *   2. exact name (case-insensitive)
 *   3. exact VLAN id (when the query is all digits)
 *   4. unique name substring (case-insensitive)
 * A substring that matches more than one network is reported as ambiguous so the
 * caller can list the candidates instead of silently picking one.
 */
export function matchNetwork<T extends NetworkRef>(networks: T[], ref: string): ResolveNetworkResult<T> {
  const q = ref.trim()
  if (!q) return { kind: 'not_found' }
  const ql = q.toLowerCase()

  const byId = networks.find((n) => n._id === q)
  if (byId) return { kind: 'ok', network: byId }

  const byName = networks.filter((n) => (n.name ?? '').toLowerCase() === ql)
  if (byName.length === 1) return { kind: 'ok', network: byName[0]! }
  if (byName.length > 1) return { kind: 'ambiguous', matches: byName }

  if (/^\d+$/.test(q)) {
    const byVlan = networks.filter((n) => n.vlan === Number(q))
    if (byVlan.length === 1) return { kind: 'ok', network: byVlan[0]! }
    if (byVlan.length > 1) return { kind: 'ambiguous', matches: byVlan }
  }

  const bySub = networks.filter((n) => (n.name ?? '').toLowerCase().includes(ql))
  if (bySub.length === 1) return { kind: 'ok', network: bySub[0]! }
  if (bySub.length > 1) return { kind: 'ambiguous', matches: bySub }

  return { kind: 'not_found' }
}

export async function getNetwork(cfg: UnifiConfig, ref: string): Promise<ResolveNetworkResult<NetworkRef & Record<string, unknown>>> {
  const networks = (await listNetworks(cfg)) as (NetworkRef & Record<string, unknown>)[]
  return matchNetwork(networks, ref)
}

export async function listUsers(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/user`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listWlans(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/wlanconf`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listPortForwards(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/portforward`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listFirewallRules(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/firewallrule`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function getFirewallRule(cfg: UnifiConfig, id: string): Promise<unknown | null> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/firewallrule/${encodeURIComponent(id)}`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data?.[0] ?? null
}

export async function controllerInfo(cfg: UnifiConfig): Promise<unknown | null> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/sysinfo`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data?.[0] ?? null
}

export async function healthWidget(cfg: UnifiConfig): Promise<unknown | null> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/widget/health`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data?.[0] ?? null
}

async function postCommand(cfg: UnifiConfig, endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  return requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/cmd/${endpoint}`,
    {
      method: 'POST',
      headers: { ...headers(cfg), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { insecureTLS: cfg.insecureTLS },
  )
}

export async function blockClient(cfg: UnifiConfig, mac: string): Promise<unknown> {
  return postCommand(cfg, 'stamgr', { cmd: 'block-sta', mac })
}

export async function unblockClient(cfg: UnifiConfig, mac: string): Promise<unknown> {
  return postCommand(cfg, 'stamgr', { cmd: 'unblock-sta', mac })
}

export async function reconnectClient(cfg: UnifiConfig, mac: string): Promise<unknown> {
  return postCommand(cfg, 'stamgr', { cmd: 'kick-sta', mac })
}

export async function powerCyclePort(cfg: UnifiConfig, mac: string, port: number): Promise<unknown> {
  return postCommand(cfg, 'devmgr', { cmd: 'power-cycle', mac, port_idx: port })
}
