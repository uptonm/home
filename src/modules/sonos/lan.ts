import { networkInterfaces } from 'node:os'

/**
 * Pick the local IPv4 address on the same /24 subnet as `peerIp`. Sonos uses
 * SSDP multicast for discovery so the host and the speakers must already share
 * a subnet; we use that as the routing hint instead of guessing the default
 * route, which avoids surprises on hosts with multiple interfaces (Tailscale,
 * Docker bridges, etc.).
 *
 * Tie-breaking: returns the first matching interface in
 * `Object.values(networkInterfaces())` iteration order, which on macOS is
 * roughly discovery order (`lo0, en0, en1, awdl0, llw0, utun*, ...`). In
 * practice that's the real LAN interface before any virtual ones. A
 * pathological multi-homed host with a Docker bridge inside the peer's /24
 * could land on the wrong address and Sonos's GET would never reach us;
 * promoting non-virtual interfaces ahead of virtual is tracked separately.
 */
export function pickLocalIpForPeer(peerIp: string): string {
  const peerPrefix = peerIp.split('.').slice(0, 3).join('.') + '.'
  const ifaces = networkInterfaces()
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith(peerPrefix)) {
        return a.address
      }
    }
  }
  throw new Error(`no local IPv4 found on subnet ${peerPrefix}0/24 (Sonos at ${peerIp})`)
}
