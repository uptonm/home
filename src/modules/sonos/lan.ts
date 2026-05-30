import { networkInterfaces } from 'node:os'

/**
 * Interface name prefixes that the kernel uses for the real LAN-facing NIC
 * on the platforms we ship for. macOS uses `en0/en1/en2/...` for both Ethernet
 * and Wi-Fi; Linux uses `eth*` (older naming), `enp*`/`ens*`/`eno*` (predictable
 * naming), and `wl*` for Wi-Fi.
 */
const PHYSICAL_PREFIXES = ['en', 'eth', 'enp', 'ens', 'eno', 'wl']

/**
 * Interface name prefixes for virtual / overlay interfaces — Docker bridges,
 * Tailscale, WireGuard, VirtualBox, etc. When a host has both a real LAN NIC
 * and one of these inside the peer's /24 (common on dev laptops with Docker
 * running), we want the real one.
 */
const VIRTUAL_PREFIXES = ['docker', 'br-', 'br', 'tun', 'tap', 'utun', 'tailscale', 'wg', 'veth', 'vbox', 'vnet']

function classify(name: string): 'physical' | 'virtual' | 'other' {
  if (PHYSICAL_PREFIXES.some((p) => name.startsWith(p))) return 'physical'
  if (VIRTUAL_PREFIXES.some((p) => name.startsWith(p))) return 'virtual'
  return 'other'
}

/**
 * Pick the local IPv4 address on the same /24 subnet as `peerIp`. Sonos uses
 * SSDP multicast for discovery so the host and the speakers must already share
 * a subnet; we use that as the routing hint instead of guessing the default
 * route, which avoids surprises on hosts with multiple interfaces (Tailscale,
 * Docker bridges, etc.).
 *
 * Tie-breaking: when multiple interfaces match the peer subnet, prefer
 * physical NICs (en*, eth*, enp*, ens*, eno*, wl*) over interfaces that look
 * "other" over interfaces that look virtual (docker, tun, utun, tailscale,
 * wg, veth, vbox). Catches the pathological Docker-bridge-inside-LAN-/24 case
 * the reviewer flagged in UPT-11: a Mac with both `en0` and `docker0` on the
 * same subnet returns `en0`'s address even though `docker0` may appear
 * earlier in `Object.values(networkInterfaces())` iteration order on some
 * platforms.
 */
/** Per-interface snapshot used by `chooseLocalIp` — kept simple so tests can hand-roll inputs. */
export interface InterfaceSnapshot {
  name: string
  address: string
  family: 'IPv4' | 'IPv6'
  internal: boolean
}

/**
 * Pure selection logic — given a peer IP and a list of interface snapshots,
 * pick the best local IPv4 address. Extracted from `pickLocalIpForPeer` so
 * the tie-breaking can be unit-tested without mocking `node:os`.
 */
export function chooseLocalIp(peerIp: string, ifaces: InterfaceSnapshot[]): string {
  const peerPrefix = peerIp.split('.').slice(0, 3).join('.') + '.'
  const candidates: { name: string; address: string; rank: number }[] = []

  for (const iface of ifaces) {
    if (iface.family !== 'IPv4' || iface.internal) continue
    if (!iface.address.startsWith(peerPrefix)) continue
    const kind = classify(iface.name)
    const rank = kind === 'physical' ? 0 : kind === 'other' ? 1 : 2
    candidates.push({ name: iface.name, address: iface.address, rank })
  }

  if (candidates.length === 0) {
    throw new Error(`no local IPv4 found on subnet ${peerPrefix}0/24 (Sonos at ${peerIp})`)
  }
  candidates.sort((a, b) => a.rank - b.rank)
  return candidates[0]!.address
}

export function pickLocalIpForPeer(peerIp: string): string {
  const ifaces = networkInterfaces()
  const flat: InterfaceSnapshot[] = []
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue
    for (const a of addrs) {
      flat.push({ name, address: a.address, family: a.family as 'IPv4' | 'IPv6', internal: a.internal })
    }
  }
  return chooseLocalIp(peerIp, flat)
}
