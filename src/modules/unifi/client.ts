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

export interface DeviceRef {
  mac?: string
  name?: string
  model?: string
  type?: string
}

export type ResolveDeviceResult<T extends DeviceRef> =
  | { kind: 'ok'; device: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; matches: T[] }

/**
 * Resolve a device by MAC or name. Pure + synchronous so it can be unit-tested
 * without hitting the controller. Resolution order:
 *   1. exact MAC (colons optional — they're normalized away)
 *   2. exact name (case-insensitive)
 *   3. unique name substring (case-insensitive)
 * A substring that matches more than one device is reported as ambiguous so the
 * caller can list the candidates instead of silently picking one.
 */
export function resolveDevice<T extends DeviceRef>(devices: T[], ref: string): ResolveDeviceResult<T> {
  const normMac = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^0-9a-f]/g, '')
  const q = ref.trim().toLowerCase()
  if (!q) return { kind: 'not_found' }

  const qMac = normMac(q)
  if (qMac.length === 12) {
    const byMac = devices.find((d) => normMac(d.mac) === qMac)
    if (byMac) return { kind: 'ok', device: byMac }
  }

  const byName = devices.filter((d) => (d.name ?? '').toLowerCase() === q)
  if (byName.length === 1) return { kind: 'ok', device: byName[0]! }
  if (byName.length > 1) return { kind: 'ambiguous', matches: byName }

  const bySub = devices.filter((d) => (d.name ?? '').toLowerCase().includes(q))
  if (bySub.length === 1) return { kind: 'ok', device: bySub[0]! }
  if (bySub.length > 1) return { kind: 'ambiguous', matches: bySub }

  return { kind: 'not_found' }
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

export async function getClient(cfg: UnifiConfig, mac: string): Promise<unknown | null> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/sta/${encodeURIComponent(mac)}`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data?.[0] ?? null
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

  // Exact name match (checked before VLAN — a network literally named "180" wins over VLAN-180)
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

export interface UserRef {
  _id: string
  name?: string
  hostname?: string
  mac?: string
  fixed_ip?: string
  use_fixedip?: boolean
}

export type ResolveUserResult<T extends UserRef> =
  | { kind: 'ok'; user: T }
  | { kind: 'ambiguous'; matches: T[] }
  | { kind: 'not_found' }

/** Normalize a MAC to a canonical 12-char lowercase hex string for comparison. */
function normalizeMac(raw: string): string {
  return raw.toLowerCase().replace(/[^0-9a-f]/g, '')
}

/** Resolve a fixed-IP reservation by MAC, name, hostname, or IP. */
export function matchReservation<T extends UserRef>(users: T[], ref: string): ResolveUserResult<T> {
  const q = ref.trim()
  if (!q) return { kind: 'not_found' }

  const fixed = (users as T[]).filter((u) => u.use_fixedip === true || Boolean(u.fixed_ip))

  // 1. MAC match (normalized, without colons)
  const normQ = normalizeMac(q)
  if (normQ.length === 12) {
    const byMac = fixed.filter((u) => u.mac && normalizeMac(u.mac) === normQ)
    if (byMac.length === 1) return { kind: 'ok', user: byMac[0]! }
    if (byMac.length > 1) return { kind: 'ambiguous', matches: byMac }
  }

  const ql = q.toLowerCase()

  // 2. Exact name/hostname/IP match
  const byExact = fixed.filter((u) =>
    (u.name ?? '').toLowerCase() === ql ||
    (u.hostname ?? '').toLowerCase() === ql ||
    u.fixed_ip === q,
  )
  if (byExact.length === 1) return { kind: 'ok', user: byExact[0]! }
  if (byExact.length > 1) return { kind: 'ambiguous', matches: byExact }

  // 3. Unique name substring
  const bySub = fixed.filter((u) => (u.name ?? '').toLowerCase().includes(ql) || (u.hostname ?? '').toLowerCase().includes(ql))
  if (bySub.length === 1) return { kind: 'ok', user: bySub[0]! }
  if (bySub.length > 1) return { kind: 'ambiguous', matches: bySub }

  return { kind: 'not_found' }
}

export async function getReservation(cfg: UnifiConfig, ref: string): Promise<ResolveUserResult<UserRef & Record<string, unknown>>> {
  const users = (await listUsers(cfg)) as (UserRef & Record<string, unknown>)[]
  return matchReservation(users, ref)
}

export async function listWlans(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/wlanconf`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function getWlan(cfg: UnifiConfig, ssid: string): Promise<unknown | null> {
  const wlans = await listWlans(cfg)
  const target = ssid.toLowerCase()
  return (
    (wlans as { name?: string }[]).find((w) => (w.name ?? '').toLowerCase() === target) ?? null
  )
}

export async function listPortForwards(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/portforward`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listFirewallGroups(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/firewallgroup`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listPortProfiles(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/portconf`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listWlanGroups(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/wlangroup`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listUserGroups(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/usergroup`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listRadiusProfiles(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/radiusprofile`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listStaticRoutes(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/routing`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listDpiApps(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/dpiapp`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listDpiGroups(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/dpigroup`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listRadiusAccounts(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/account`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listDynamicDns(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/dynamicdns`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listTags(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/tag`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listSettings(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/rest/setting`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listAllClients(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/alluser`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listEvents(cfg: UnifiConfig, limit?: number): Promise<unknown[]> {
  const body = limit
    ? await requestJson<{ data: unknown[] }>(
        `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/event`,
        { method: 'POST', headers: { ...headers(cfg), 'Content-Type': 'application/json' }, body: JSON.stringify({ _limit: limit }) },
        { insecureTLS: cfg.insecureTLS },
      )
    : await requestJson<{ data: unknown[] }>(
        `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/event`,
        { headers: headers(cfg) },
        { insecureTLS: cfg.insecureTLS },
      )
  return body.data ?? []
}

export async function listAlarms(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/alarm`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listRogueAps(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/rogueap`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listGuests(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/authorization`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function listSessions(cfg: UnifiConfig, limit?: number): Promise<unknown[]> {
  const body = limit
    ? await requestJson<{ data: unknown[] }>(
        `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/sessions`,
        { method: 'POST', headers: { ...headers(cfg), 'Content-Type': 'application/json' }, body: JSON.stringify({ _limit: limit }) },
        { insecureTLS: cfg.insecureTLS },
      )
    : await requestJson<{ data: unknown[] }>(
        `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/sessions`,
        { headers: headers(cfg) },
        { insecureTLS: cfg.insecureTLS },
      )
  return body.data ?? []
}

export async function listSiteDpi(cfg: UnifiConfig): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/sitedpi`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export async function getClientDpi(cfg: UnifiConfig, mac: string): Promise<unknown[]> {
  const body = await requestJson<{ data: unknown[] }>(
    `${cfg.url}/proxy/network/api/s/${encodeURIComponent(cfg.site)}/stat/stadpi/${encodeURIComponent(mac)}`,
    { headers: headers(cfg) },
    { insecureTLS: cfg.insecureTLS },
  )
  return body.data ?? []
}

export interface PortForwardRef {
  _id: string
  name?: string
}

export type ResolvePortForwardResult<T extends PortForwardRef> =
  | { kind: 'ok'; rule: T }
  | { kind: 'ambiguous'; matches: T[] }
  | { kind: 'not_found' }

/** Resolve a port-forward rule by name or _id. */
export function matchPortForward<T extends PortForwardRef>(rules: T[], ref: string): ResolvePortForwardResult<T> {
  const q = ref.trim()
  if (!q) return { kind: 'not_found' }
  const ql = q.toLowerCase()

  const byId = rules.find((r) => r._id === q)
  if (byId) return { kind: 'ok', rule: byId }

  const byName = rules.filter((r) => (r.name ?? '').toLowerCase() === ql)
  if (byName.length === 1) return { kind: 'ok', rule: byName[0]! }
  if (byName.length > 1) return { kind: 'ambiguous', matches: byName }

  const bySub = rules.filter((r) => (r.name ?? '').toLowerCase().includes(ql))
  if (bySub.length === 1) return { kind: 'ok', rule: bySub[0]! }
  if (bySub.length > 1) return { kind: 'ambiguous', matches: bySub }

  return { kind: 'not_found' }
}

export async function getPortForward(cfg: UnifiConfig, ref: string): Promise<ResolvePortForwardResult<PortForwardRef & Record<string, unknown>>> {
  const rules = (await listPortForwards(cfg)) as (PortForwardRef & Record<string, unknown>)[]
  return matchPortForward(rules, ref)
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
