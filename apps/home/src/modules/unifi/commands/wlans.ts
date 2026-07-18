import type { CommandSpec } from '../../../core/types'
import { getWlan, listNetworks, listWlans, readUnifiConfig } from '../client'

interface RawWlan {
  name?: string
  security?: string
  wpa_mode?: string
  enabled?: boolean
  is_guest?: boolean
  hide_ssid?: boolean
  wlan_band?: string
  networkconf_id?: string
}

interface RawNetwork {
  _id?: string
  name?: string
  vlan?: number
}

export const wlansList: CommandSpec = {
  path: ['wlans', 'list'],
  effect: 'read',
  description: 'List wireless networks (SSIDs) with security and mapped VLAN',
  args: [],
  examples: [
    'home unifi wlans list',
    'home unifi wlans list --json | jq \'.[] | select(.enabled)\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const [wlans, networks] = await Promise.all([listWlans(cfg), listNetworks(cfg)])

    const byId = new Map<string, RawNetwork>()
    for (const n of networks as RawNetwork[]) if (n._id) byId.set(n._id, n)

    const data = (wlans as RawWlan[])
      .map((w) => {
        const net = w.networkconf_id ? byId.get(w.networkconf_id) : undefined
        return {
          ssid: w.name ?? '',
          security: w.wpa_mode ? `${w.security ?? ''}/${w.wpa_mode}` : (w.security ?? ''),
          band: w.wlan_band ?? '',
          guest: Boolean(w.is_guest),
          enabled: w.enabled ?? null,
          network: net?.name ?? '',
          vlan: net?.vlan ?? null,
        }
      })
      .sort((a, b) => a.ssid.localeCompare(b.ssid))

    return { ok: true, data }
  },
}

export const wlansGet: CommandSpec = {
  path: ['wlans', 'get'],
  effect: 'read',
  description: 'Dump the full raw wlanconf for a single SSID (proxy_arp, mcastenhance, dtim, fast_roaming, etc)',
  args: [{ name: 'ssid', kind: 'positional', description: 'SSID name (case-insensitive)', required: true }],
  examples: [
    'home unifi wlans get IoT',
    'home unifi wlans get "Guest WiFi" --json | jq \'{proxy_arp, dtim_mode, fast_roaming_enabled}\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ssid = String(ctx.args.ssid ?? '')
    if (!ssid) return { ok: false, kind: 'user', message: 'ssid is required', code: 'missing_arg' }
    const data = await getWlan(cfg, ssid)
    if (!data) return { ok: false, kind: 'user', message: `no SSID named ${ssid}`, code: 'not_found' }
    return { ok: true, data }
  },
}
