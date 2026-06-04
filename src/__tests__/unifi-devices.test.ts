import { describe, expect, test } from 'bun:test'
import { resolveDevice } from '../modules/unifi/client'
import type { DeviceRef } from '../modules/unifi/client'

const fixture: DeviceRef[] = [
  { mac: '78:8a:20:11:22:33', name: 'UDM-Pro-SE', type: 'udm' },
  { mac: 'aa:bb:cc:dd:ee:01', name: 'USW-Agg', type: 'usw' },
  { mac: 'aa:bb:cc:dd:ee:02', name: 'USW-48-MDF', type: 'usw' },
  { mac: 'aa:bb:cc:dd:ee:03', name: 'USW-48-IDF', type: 'usw' },
  { mac: 'aa:bb:cc:dd:ee:04', name: 'Living Room AP', type: 'uap' },
]

describe('resolveDevice', () => {
  test('exact MAC with colons', () => {
    const r = resolveDevice(fixture, '78:8a:20:11:22:33')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.device.name).toBe('UDM-Pro-SE')
  })

  test('exact MAC without colons', () => {
    const r = resolveDevice(fixture, '788a20112233')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.device.name).toBe('UDM-Pro-SE')
  })

  test('MAC is case-insensitive', () => {
    const r = resolveDevice(fixture, 'AA:BB:CC:DD:EE:01')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.device.name).toBe('USW-Agg')
  })

  test('exact name (case-insensitive)', () => {
    const r = resolveDevice(fixture, 'usw-agg')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.device.mac).toBe('aa:bb:cc:dd:ee:01')
  })

  test('unique name substring resolves', () => {
    const r = resolveDevice(fixture, 'living')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.device.name).toBe('Living Room AP')
  })

  test('exact name beats substring (USW-Agg is its own exact match)', () => {
    // "USW-Agg" is a substring of nothing else, but verify exact-name precedence
    const r = resolveDevice(fixture, 'USW-Agg')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.device.name).toBe('USW-Agg')
  })

  test('ambiguous substring returns all candidates', () => {
    const r = resolveDevice(fixture, 'usw-48')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') {
      expect(r.matches.length).toBe(2)
      expect(r.matches.map((d) => d.name).sort()).toEqual(['USW-48-IDF', 'USW-48-MDF'])
    }
  })

  test('not found', () => {
    expect(resolveDevice(fixture, 'nonexistent').kind).toBe('not_found')
  })

  test('empty ref is not found', () => {
    expect(resolveDevice(fixture, '   ').kind).toBe('not_found')
  })

  test('partial MAC (not 12 hex) falls through to name matching, not found', () => {
    expect(resolveDevice(fixture, 'aa:bb').kind).toBe('not_found')
  })

  test('tolerates devices with missing name', () => {
    const withMissing: DeviceRef[] = [{ mac: 'ff:ff:ff:ff:ff:ff' }, ...fixture]
    const r = resolveDevice(withMissing, 'udm-pro-se')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.device.name).toBe('UDM-Pro-SE')
  })
})
