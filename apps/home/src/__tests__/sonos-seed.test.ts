import { describe, expect, test } from 'bun:test'
import { parseSeedHost, readSonosConfig } from '../modules/sonos/client'

describe('parseSeedHost (pure)', () => {
  test('returns null for absent / blank input (falls back to multicast)', () => {
    expect(parseSeedHost(undefined)).toBeNull()
    expect(parseSeedHost('')).toBeNull()
    expect(parseSeedHost('   ')).toBeNull()
  })

  test('parses a bare host, defaulting the Sonos control port', () => {
    expect(parseSeedHost('10.0.10.27')).toEqual({ host: '10.0.10.27', port: 1400 })
  })

  test('parses host:port', () => {
    expect(parseSeedHost('10.0.10.27:1401')).toEqual({ host: '10.0.10.27', port: 1401 })
  })

  test('trims surrounding whitespace', () => {
    expect(parseSeedHost('  10.0.10.27  ')).toEqual({ host: '10.0.10.27', port: 1400 })
  })

  test('treats a bare IPv6 literal as the host (multiple colons → no port split)', () => {
    expect(parseSeedHost('fe80::1')).toEqual({ host: 'fe80::1', port: 1400 })
  })

  test('rejects an out-of-range port', () => {
    expect(() => parseSeedHost('10.0.10.27:0')).toThrow(/invalid SONOS_SEED_HOST port/)
    expect(() => parseSeedHost('10.0.10.27:70000')).toThrow(/invalid SONOS_SEED_HOST port/)
  })

  test('rejects a non-numeric port', () => {
    expect(() => parseSeedHost('10.0.10.27:abc')).toThrow(/invalid SONOS_SEED_HOST port/)
  })

  test('rejects a missing host before the colon', () => {
    expect(() => parseSeedHost(':1400')).toThrow(/invalid SONOS_SEED_HOST/)
  })
})

describe('readSonosConfig seed wiring', () => {
  test('config.seedHost takes effect', () => {
    expect(readSonosConfig({ seedHost: '10.0.10.27' }).seed).toEqual({ host: '10.0.10.27', port: 1400 })
  })

  test('no seed configured → null (multicast path)', () => {
    const prev = process.env.SONOS_SEED_HOST
    delete process.env.SONOS_SEED_HOST
    try {
      expect(readSonosConfig({}).seed).toBeNull()
    } finally {
      if (prev !== undefined) process.env.SONOS_SEED_HOST = prev
    }
  })

  test('SONOS_SEED_HOST env var is read when config is absent', () => {
    const prev = process.env.SONOS_SEED_HOST
    process.env.SONOS_SEED_HOST = '10.0.10.93:1400'
    try {
      expect(readSonosConfig({}).seed).toEqual({ host: '10.0.10.93', port: 1400 })
    } finally {
      if (prev === undefined) delete process.env.SONOS_SEED_HOST
      else process.env.SONOS_SEED_HOST = prev
    }
  })
})
