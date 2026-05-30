import { networkInterfaces } from 'node:os'
import { createSocket } from 'node:dgram'

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

/**
 * The local source IPv4 the kernel would use to reach `peerIp` *right now*,
 * found by opening a connected — but never sent-on — UDP socket and reading
 * the address the kernel binds to it. `connect()` on a datagram socket only
 * fixes the default destination; no packet leaves the host, but it forces the
 * route lookup + implicit bind so `address()` reports the egress source IP.
 *
 * This reads the live routing table rather than assuming any fixed topology,
 * so it adapts whether routing is static or dynamic. Unlike `chooseLocalIp` it
 * also works when the speaker is on a different subnet reachable via a gateway
 * (Sonos on another VLAN). Async because the socket must bind first.
 */
export function routableLocalIp(peerIp: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createSocket('udp4')
    sock.once('error', (err) => {
      sock.close()
      reject(err)
    })
    // Port 9 (discard) is arbitrary — nothing is ever sent here.
    sock.connect(9, peerIp, () => {
      try {
        const addr = sock.address().address
        sock.close()
        if (!addr || addr === '0.0.0.0') {
          reject(new Error(`could not determine a local IP routable to ${peerIp}`))
          return
        }
        resolve(addr)
      } catch (err) {
        sock.close()
        reject(err as Error)
      }
    })
  })
}

/**
 * Resolve the local IPv4 to advertise to a Sonos speaker at `peerIp` for the
 * `notify` HTTP server. Prefers an interface on the speaker's own /24 — the
 * common same-segment case, with the physical-over-virtual tie-break in
 * `chooseLocalIp` — and falls back to the kernel's routable source IP when the
 * speaker is on a different subnet. The fallback is what makes `notify --file`
 * work when discovery was seeded across a VLAN via SONOS_SEED_HOST.
 */
export async function localIpForPeer(peerIp: string): Promise<string> {
  try {
    return pickLocalIpForPeer(peerIp)
  } catch {
    return await routableLocalIp(peerIp)
  }
}
