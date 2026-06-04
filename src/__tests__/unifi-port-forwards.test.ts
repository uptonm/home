import { describe, expect, test } from 'bun:test'
import { matchPortForward } from '../modules/unifi/client'
import type { PortForwardRef } from '../modules/unifi/client'
import { portForwardsGet } from '../modules/unifi/commands/port-forwards'

const fixture: PortForwardRef[] = [
  { _id: 'a1', name: 'Plex' },
  { _id: 'b2', name: 'SSH' },
  { _id: 'c3', name: 'Web Server' },
  { _id: 'd4', name: 'Web Dev' },
]

const EMPTY_CTX = { config: {}, json: false, quiet: true, verbose: false, log: null as unknown as ReturnType<typeof import('consola').createConsola>, args: {} }

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

describe('matchPortForward', () => {
  test('resolves by exact _id', () => {
    const r = matchPortForward(fixture, 'b2')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.rule.name).toBe('SSH')
  })

  test('resolves by exact name (case-insensitive)', () => {
    const r = matchPortForward(fixture, 'plex')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.rule._id).toBe('a1')
  })

  test('unique name substring resolves', () => {
    const r = matchPortForward(fixture, 'ssh')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.rule._id).toBe('b2')
  })

  test('substring matching multiple is ambiguous', () => {
    const r = matchPortForward(fixture, 'web')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.matches.length).toBe(2)
  })

  test('unknown name is not_found', () => {
    expect(matchPortForward(fixture, 'nonexistent').kind).toBe('not_found')
  })

  test('empty query is not_found', () => {
    expect(matchPortForward(fixture, '   ').kind).toBe('not_found')
  })
})

describe('unifi port-forwards get', () => {
  test('command path is port-forwards get', () => {
    expect(portForwardsGet.path).toEqual(['port-forwards', 'get'])
  })

  test('declares a required name positional arg', () => {
    const name = portForwardsGet.args.find((a) => a.name === 'name')
    expect(name).toBeDefined()
    expect(name?.kind).toBe('positional')
    expect(name?.required).toBe(true)
  })

  test('rejects empty name', async () => {
    expect(errCode(await portForwardsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })
})
