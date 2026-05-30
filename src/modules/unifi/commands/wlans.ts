import type { CommandSpec } from '../../../core/types'
import { listNetworks, listWlans, readUnifiConfig } from '../client'

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
          security: w.wpa_mode ? `${w.security}/${w.wpa_mode}` : (w.security ?? ''),
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
