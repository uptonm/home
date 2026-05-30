import type { CommandSpec } from '../../../core/types'
import { listNetworks, listUsers, readUnifiConfig } from '../client'

interface RawUser {
  name?: string
  hostname?: string
  mac?: string
  fixed_ip?: string
  use_fixedip?: boolean
}

interface RawNetwork {
  name?: string
  vlan?: number
  ip_subnet?: string
}

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    n = n * 256 + octet
  }
  return n >>> 0
}

/**
 * `rest/user` reservations do not carry a usable `network_id`, so we label each
 * reservation by matching its `fixed_ip` against each network's `ip_subnet`
 * CIDR. The subnet base is the gateway IP (e.g. 10.0.20.1/24); masking it
 * yields the network address, so a straight masked compare works.
 */
function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.indexOf('/')
  if (slash < 0) return false
  const base = ipToInt(cidr.slice(0, slash))
  const prefix = Number(cidr.slice(slash + 1))
  const addr = ipToInt(ip)
  if (base === null || addr === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  if (prefix === 0) return true
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return (base & mask) === (addr & mask)
}

export const reservationsList: CommandSpec = {
  path: ['reservations', 'list'],
  description: 'List fixed-IP reservations, each labeled with its VLAN/network',
  args: [],
  examples: [
    'home unifi reservations list',
    'home unifi reservations list --json | jq \'.[] | select(.vlan==200)\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const [users, networks] = await Promise.all([listUsers(cfg), listNetworks(cfg)])

    const subnets = (networks as RawNetwork[])
      .filter((n) => n.ip_subnet)
      .map((n) => ({ name: n.name ?? '', vlan: n.vlan ?? null, cidr: n.ip_subnet as string }))

    const data = (users as RawUser[])
      .filter((u) => u.use_fixedip === true || Boolean(u.fixed_ip))
      .map((u) => {
        const ip = u.fixed_ip ?? ''
        const net = ip ? subnets.find((s) => cidrContains(s.cidr, ip)) : undefined
        return {
          name: u.name || u.hostname || u.mac || '',
          ip,
          mac: u.mac ?? '',
          network: net?.name ?? '',
          vlan: net?.vlan ?? null,
        }
      })
      .sort((a, b) => (a.vlan ?? 0) - (b.vlan ?? 0) || (ipToInt(a.ip) ?? 0) - (ipToInt(b.ip) ?? 0))

    return { ok: true, data }
  },
}
