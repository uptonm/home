import { describe, expect, test } from 'bun:test'
import { pickLocalIpForPeer } from '../modules/sonos/lan'
import { networkInterfaces } from 'node:os'

describe('pickLocalIpForPeer', () => {
  test('returns a local IPv4 on the same /24 as the peer for a real interface', () => {
    const ifaces = networkInterfaces()
    let peerCandidate: string | undefined
    for (const addrs of Object.values(ifaces)) {
      if (!addrs) continue
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal) {
          peerCandidate = a.address.split('.').slice(0, 3).join('.') + '.1'
          break
        }
      }
      if (peerCandidate) break
    }
    if (!peerCandidate) return // no usable interface on this host; skip
    const picked = pickLocalIpForPeer(peerCandidate)
    expect(picked.startsWith(peerCandidate.split('.').slice(0, 3).join('.') + '.')).toBe(true)
  })

  test('throws a clear error when no local interface matches the peer subnet', () => {
    expect(() => pickLocalIpForPeer('203.0.113.42')).toThrow(/no local IPv4/)
  })
})
