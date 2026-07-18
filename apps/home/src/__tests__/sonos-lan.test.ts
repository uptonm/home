import { describe, expect, test } from 'bun:test'
import { chooseLocalIp, localIpForPeer, pickLocalIpForPeer, routableLocalIp, type InterfaceSnapshot } from '../modules/sonos/lan'
import { networkInterfaces } from 'node:os'

function firstRealIpv4(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return undefined
}

const v4 = (name: string, address: string, internal = false): InterfaceSnapshot => ({
  name, address, family: 'IPv4', internal,
})

describe('pickLocalIpForPeer (live)', () => {
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

describe('chooseLocalIp (pure)', () => {
  test('prefers a physical NIC over a Docker bridge inside the same /24', () => {
    const picked = chooseLocalIp('10.0.10.252', [
      v4('docker0', '10.0.10.1'),
      v4('en0', '10.0.10.166'),
    ])
    expect(picked).toBe('10.0.10.166')
  })

  test('prefers en0 over utun (Tailscale) regardless of iteration order', () => {
    const picked = chooseLocalIp('10.0.10.252', [
      v4('utun0', '10.0.10.99'),
      v4('en0', '10.0.10.166'),
    ])
    expect(picked).toBe('10.0.10.166')
  })

  test('prefers "other"-classified interfaces over virtual ones when no physical match', () => {
    const picked = chooseLocalIp('10.0.10.252', [
      v4('br-docker', '10.0.10.50'),
      v4('vmnet8', '10.0.10.99'),
    ])
    expect(picked).toBe('10.0.10.99')
  })

  test('returns the only match when there is just one', () => {
    const picked = chooseLocalIp('10.0.10.252', [v4('en0', '10.0.10.166')])
    expect(picked).toBe('10.0.10.166')
  })

  test('ignores internal and non-IPv4 entries', () => {
    expect(() => chooseLocalIp('10.0.10.252', [
      v4('lo0', '127.0.0.1', true),
      { name: 'en0', address: 'fe80::1', family: 'IPv6', internal: false },
      v4('en1', '192.168.1.5'),
    ])).toThrow(/no local IPv4/)
  })

  test('throws when nothing matches the peer subnet', () => {
    expect(() =>
      chooseLocalIp('203.0.113.42', [v4('en0', '10.0.10.166')]),
    ).toThrow(/no local IPv4/)
  })
})

describe('routableLocalIp (live)', () => {
  test('returns a local IPv4 the kernel would use to reach a routable peer', async () => {
    const own = firstRealIpv4()
    if (!own) return // no usable interface on this host; skip
    // Reaching our own address routes locally; the source IP is a real local IPv4.
    const ip = await routableLocalIp(own)
    expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(ip).not.toBe('0.0.0.0')
  })
})

describe('localIpForPeer (live)', () => {
  test('falls back to the routable source IP when no interface shares the peer /24', async () => {
    const own = firstRealIpv4()
    if (!own) return // no usable interface on this host; skip
    // 198.18.0.0/15 is reserved benchmarking space — no host interface is on it,
    // so the same-subnet pick misses and we exercise the routable fallback.
    const ip = await localIpForPeer('198.18.0.1')
    expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(ip).not.toBe('0.0.0.0')
  })

  test('prefers the same-subnet pick when one exists', async () => {
    const own = firstRealIpv4()
    if (!own) return // skip
    const peer = own.split('.').slice(0, 3).join('.') + '.254'
    const ip = await localIpForPeer(peer)
    expect(ip.split('.').slice(0, 3).join('.')).toBe(own.split('.').slice(0, 3).join('.'))
  })
})
