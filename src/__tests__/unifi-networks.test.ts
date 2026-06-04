import { describe, expect, test } from 'bun:test'
import { matchNetwork } from '../modules/unifi/client'
import type { NetworkRef } from '../modules/unifi/client'

const fixture: NetworkRef[] = [
  { _id: 'a1', name: 'Default', vlan: 1 },
  { _id: 'b2', name: 'IoT', vlan: 180 },
  { _id: 'c3', name: 'IoT Guest', vlan: 181 },
  { _id: 'd4', name: 'Cameras', vlan: 160 },
  { _id: 'e5', name: 'Servers', vlan: 140 },
]

describe('matchNetwork', () => {
  test('resolves by exact _id', () => {
    const r = matchNetwork(fixture, 'b2')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.network.name).toBe('IoT')
  })

  test('resolves by exact name (case-insensitive)', () => {
    const r = matchNetwork(fixture, 'cameras')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.network._id).toBe('d4')
  })

  test('exact name beats substring (IoT not IoT Guest)', () => {
    const r = matchNetwork(fixture, 'IoT')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.network._id).toBe('b2')
  })

  test('resolves by VLAN id', () => {
    const r = matchNetwork(fixture, '160')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.network.name).toBe('Cameras')
  })

  test('unique name substring resolves', () => {
    const r = matchNetwork(fixture, 'serv')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.network._id).toBe('e5')
  })

  test('substring with a single hit resolves', () => {
    const r = matchNetwork(fixture, 'guest')
    expect(r.kind).toBe('ok') // only "IoT Guest" contains "guest"
    if (r.kind === 'ok') expect(r.network._id).toBe('c3')
  })

  test('substring matching multiple is ambiguous', () => {
    const r = matchNetwork(fixture, 'iot')
    // "iot" exact-matches "IoT"; exact wins over the two substring hits
    expect(r.kind).toBe('ok')
  })

  test('substring with no exact match and multiple hits is ambiguous', () => {
    const r = matchNetwork(fixture, 'io')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.matches.length).toBe(2)
  })

  test('unknown VLAN id is not_found', () => {
    expect(matchNetwork(fixture, '999').kind).toBe('not_found')
  })

  test('unknown name is not_found', () => {
    expect(matchNetwork(fixture, 'Nonexistent').kind).toBe('not_found')
  })

  test('empty query is not_found', () => {
    expect(matchNetwork(fixture, '   ').kind).toBe('not_found')
  })
})
