import { networkInterfaces } from 'node:os'

/**
 * Pick the local IPv4 address on the same /24 subnet as `peerIp`. Sonos uses
 * SSDP multicast for discovery so the host and the speakers must already share
 * a subnet; we use that as the routing hint instead of guessing the default
 * route, which avoids surprises on hosts with multiple interfaces (Tailscale,
 * Docker bridges, etc.).
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
