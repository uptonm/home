import { describe, expect, test } from 'bun:test'
import { decodeKey, encodeKey, fieldFor, KEY_PREFIX } from '../modules/vercel/sync'
import { modules } from '../registry'

describe('key encoding', () => {
  test('round-trips a camelCase field without lowering it', () => {
    const key = encodeKey('unifi', 'insecureTLS')
    expect(key).toBe('HOME__unifi__insecureTLS')
    expect(decodeKey(key)).toEqual({ module: 'unifi', field: 'insecureTLS' })
  })

  test('round-trips every syncable field in the registry', () => {
    for (const m of modules) {
      for (const f of m.configSchema) {
        expect(decodeKey(encodeKey(m.name, f.key))).toEqual({ module: m.name, field: f.key })
      }
    }
  })

  test('ignores keys that are not ours', () => {
    expect(decodeKey('DATABASE_URL')).toBeNull()
    expect(decodeKey('HOME_UPPER_TEST')).toBeNull()
    expect(decodeKey(`${KEY_PREFIX}nosep`)).toBeNull()
  })
})

describe('host-local fields are never synced', () => {
  test('sonos.subnet is marked hostLocal', () => {
    const sonos = modules.find((m) => m.name === 'sonos')!
    const subnet = sonos.configSchema.find((f) => f.key === 'subnet')!
    expect(subnet.hostLocal).toBe(true)
  })

  test('fieldFor refuses a hostLocal field, so pull cannot apply it', () => {
    expect(fieldFor('sonos', 'subnet')).toBeNull()
  })

  test('fieldFor refuses the vercel module itself', () => {
    expect(fieldFor('vercel', 'teamSlug')).toBeNull()
  })

  test('fieldFor refuses unknown modules and fields', () => {
    expect(fieldFor('nope', 'url')).toBeNull()
    expect(fieldFor('unifi', 'nope')).toBeNull()
  })

  test('fieldFor resolves a normal field', () => {
    expect(fieldFor('unifi', 'insecureTLS')?.kind).toBe('boolean')
  })
})
