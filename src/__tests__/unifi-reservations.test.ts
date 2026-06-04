import { describe, expect, test } from 'bun:test'
import { matchReservation } from '../modules/unifi/client'
import type { UserRef } from '../modules/unifi/client'
import { reservationsGet } from '../modules/unifi/commands/reservations'

const fixture: UserRef[] = [
  { _id: 'a1', name: 'Minisforum', hostname: 'minisforum', mac: '78:8a:20:11:22:33', fixed_ip: '10.0.14.10', use_fixedip: true },
  { _id: 'b2', name: 'Printer', mac: 'aa:bb:cc:dd:ee:ff', fixed_ip: '10.0.14.20', use_fixedip: true },
  { _id: 'c3', name: 'Server', hostname: 'pve', mac: '11:22:33:44:55:66', fixed_ip: '10.0.14.30', use_fixedip: true },
  { _id: 'd4', name: 'DNS', hostname: 'dns-1', mac: '22:33:44:55:66:77', fixed_ip: '10.0.14.40', use_fixedip: true },
  { _id: 'e5', mac: '33:44:55:66:77:88', fixed_ip: '', use_fixedip: false }, // not fixed
  { _id: 'f6', name: 'No Fixed IP Device', mac: '44:55:66:77:88:99' }, // no fixed_ip at all
]

const EMPTY_CTX = { config: {}, json: false, quiet: true, verbose: false, log: null as unknown as ReturnType<typeof import('consola').createConsola>, args: {} }

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

describe('matchReservation', () => {
  test('resolves by exact MAC (with colons)', () => {
    const r = matchReservation(fixture, '78:8a:20:11:22:33')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.user.name).toBe('Minisforum')
  })

  test('resolves by MAC without colons', () => {
    const r = matchReservation(fixture, '788a20112233')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.user.name).toBe('Minisforum')
  })

  test('resolves by MAC with mixed case and separators', () => {
    const r = matchReservation(fixture, 'AA-BB-CC-DD-EE-FF')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.user.name).toBe('Printer')
  })

  test('resolves by exact name (case-insensitive)', () => {
    const r = matchReservation(fixture, 'printer')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.user._id).toBe('b2')
  })

  test('resolves by hostname', () => {
    const r = matchReservation(fixture, 'pve')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.user.name).toBe('Server')
  })

  test('resolves by fixed IP', () => {
    const r = matchReservation(fixture, '10.0.14.30')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.user.name).toBe('Server')
  })

  test('resolves by unique name substring', () => {
    const r = matchReservation(fixture, 'mini')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.user._id).toBe('a1')
  })

  test('ignores users without fixed_ip', () => {
    // e5 has fixed_ip: '' and use_fixedip: false — should not match
    expect(matchReservation(fixture, '33:44:55:66:77:88').kind).toBe('not_found')
    // f6 has no fixed_ip at all
    expect(matchReservation(fixture, '44:55:66:77:88:99').kind).toBe('not_found')
  })

  test('unknown ref is not_found', () => {
    expect(matchReservation(fixture, 'nonexistent').kind).toBe('not_found')
  })

  test('empty query is not_found', () => {
    expect(matchReservation(fixture, '   ').kind).toBe('not_found')
  })
})

describe('unifi reservations get', () => {
  test('command path is reservations get', () => {
    expect(reservationsGet.path).toEqual(['reservations', 'get'])
  })

  test('declares a required ref positional arg', () => {
    const ref = reservationsGet.args.find((a) => a.name === 'ref')
    expect(ref).toBeDefined()
    expect(ref?.kind).toBe('positional')
    expect(ref?.required).toBe(true)
  })

  test('rejects empty ref', async () => {
    expect(errCode(await reservationsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })
})