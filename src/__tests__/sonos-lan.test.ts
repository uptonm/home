import { describe, expect, test } from 'bun:test'
import { chooseLocalIp, pickLocalIpForPeer, type InterfaceSnapshot } from '../modules/sonos/lan'
import { networkInterfaces } from 'node:os'

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
