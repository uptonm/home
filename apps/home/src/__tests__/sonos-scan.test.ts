import { describe, expect, test } from 'bun:test'
import { cidrHosts, findSonosSeed, validateCidr } from '../modules/sonos/scan'

describe('cidrHosts (pure)', () => {
  test('expands a /24 to 254 usable hosts, excluding network + broadcast', () => {
    const hosts = cidrHosts('10.0.10.0/24')
    expect(hosts.length).toBe(254)
    expect(hosts[0]).toBe('10.0.10.1')
    expect(hosts[hosts.length - 1]).toBe('10.0.10.254')
    expect(hosts).not.toContain('10.0.10.0')
    expect(hosts).not.toContain('10.0.10.255')
  })

  test('honors a non-zero network base and /30 size', () => {
    expect(cidrHosts('192.168.1.64/30')).toEqual(['192.168.1.65', '192.168.1.66'])
  })

  test('normalizes a host bit in the address down to the network', () => {
    expect(cidrHosts('10.0.10.27/24')[0]).toBe('10.0.10.1')
  })

  test('rejects malformed input, bad octets, and out-of-range prefixes', () => {
    expect(() => cidrHosts('not-a-cidr')).toThrow(/invalid CIDR/)
    expect(() => cidrHosts('10.0.10.0')).toThrow(/invalid CIDR/)
    expect(() => cidrHosts('10.0.300.0/24')).toThrow(/octet > 255/)
    expect(() => cidrHosts('10.0.0.0/8')).toThrow(/out of range/)
    expect(() => cidrHosts('10.0.10.1/32')).toThrow(/out of range/)
  })
})

describe('validateCidr (config-field validator)', () => {
  test('accepts blank (multicast) and a valid CIDR', () => {
    expect(validateCidr('')).toBeNull()
    expect(validateCidr('   ')).toBeNull()
    expect(validateCidr('10.0.10.0/24')).toBeNull()
  })

  test('returns the parse error for an invalid CIDR', () => {
    expect(validateCidr('10.0.10.0')).toMatch(/invalid CIDR/)
    expect(validateCidr('10.0.0.0/8')).toMatch(/out of range/)
  })
})

describe('findSonosSeed (live)', () => {
  test('returns null when no host in the range answers as Sonos', async () => {
    // 198.18.0.0/15 is reserved benchmarking space — nothing should answer.
    const seed = await findSonosSeed('198.18.0.0/30', { timeoutMs: 200 })
    expect(seed).toBeNull()
  })
})
