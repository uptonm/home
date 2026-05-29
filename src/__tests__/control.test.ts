import { describe, expect, test } from 'bun:test'
import { parseColor } from '../modules/assistant/commands/control'
import { matchEntity, searchStates } from '../modules/assistant/client'
import type { HassState } from '../modules/assistant/client'

const fixture: HassState[] = [
  { entity_id: 'light.tv', state: 'on', attributes: { friendly_name: 'TV' } },
  { entity_id: 'light.lamp', state: 'on', attributes: { friendly_name: 'Lamp' } },
  { entity_id: 'light.floor_lamp', state: 'off', attributes: { friendly_name: 'Floor Lamp' } },
  { entity_id: 'light.living_room', state: 'on', attributes: { friendly_name: 'Living Room' } },
  { entity_id: 'light.living_room_ap_led', state: 'on', attributes: { friendly_name: 'Living Room AP LED' } },
]

describe('matchEntity', () => {
  test('exact entity_id (case-insensitive)', () => {
    expect(matchEntity(fixture, 'LIGHT.TV')).toEqual({ kind: 'ok', entity: { entity_id: 'light.tv', friendly_name: 'TV' } })
  })
  test('exact friendly_name (case-insensitive)', () => {
    expect(matchEntity(fixture, 'tv')).toEqual({ kind: 'ok', entity: { entity_id: 'light.tv', friendly_name: 'TV' } })
  })
  test('exact friendly_name beats substring (Lamp not Floor Lamp)', () => {
    const r = matchEntity(fixture, 'Lamp')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.entity.entity_id).toBe('light.lamp')
  })
  test('exact friendly_name beats substring (Living Room not the LED)', () => {
    const r = matchEntity(fixture, 'Living Room')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.entity.entity_id).toBe('light.living_room')
  })
  test('unique substring resolves', () => {
    const r = matchEntity(fixture, 'floor')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.entity.entity_id).toBe('light.floor_lamp')
  })
  test('ambiguous substring returns candidates', () => {
    const r = matchEntity(fixture, 'room')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.matches.length).toBe(2)
  })
  test('not found', () => {
    expect(matchEntity(fixture, 'kitchen').kind).toBe('not_found')
  })
})

describe('searchStates', () => {
  test('matches by entity_id substring', () => {
    const r = searchStates(fixture, 'floor')
    expect(r).toHaveLength(1)
    expect(r[0]!.entity_id).toBe('light.floor_lamp')
  })

  test('matches by friendly_name substring', () => {
    const r = searchStates(fixture, 'room')
    expect(r).toHaveLength(2)
    expect(r.map((x) => x.entity_id).sort()).toEqual(['light.living_room', 'light.living_room_ap_led'])
  })

  test('case-insensitive', () => {
    const r = searchStates(fixture, 'LAMP')
    expect(r).toHaveLength(2)
  })

  test('no match returns empty', () => {
    expect(searchStates(fixture, 'kitchen')).toHaveLength(0)
  })

  test('empty query matches everything', () => {
    expect(searchStates(fixture, '')).toHaveLength(fixture.length)
  })
})

describe('parseColor', () => {
  test('parses hex with hash', () => {
    expect(parseColor('#3050ff')).toEqual({ rgb_color: [48, 80, 255] })
  })
  test('parses hex without hash', () => {
    expect(parseColor('ff0000')).toEqual({ rgb_color: [255, 0, 0] })
  })
  test('parses r,g,b with spaces', () => {
    expect(parseColor('180, 30, 230')).toEqual({ rgb_color: [180, 30, 230] })
  })
  test('parses r,g,b tight', () => {
    expect(parseColor('0,0,0')).toEqual({ rgb_color: [0, 0, 0] })
  })
  test('rejects out-of-range rgb', () => {
    expect(parseColor('300,0,0')).toBeNull()
  })
  test('treats a bare word as a color name (lowercased)', () => {
    expect(parseColor('Purple')).toEqual({ color_name: 'purple' })
  })
  test('rejects garbage', () => {
    expect(parseColor('#ggg')).toBeNull()
    expect(parseColor('12,34')).toBeNull()
    expect(parseColor('rgb(1,2,3)')).toBeNull()
  })
})
