import { describe, expect, test } from 'bun:test'
import { resolve } from '../modules/protect/resolve'

const fixture = [
  { id: 'a1', name: 'Front Door' },
  { id: 'b2', name: 'Back Patio' },
  { id: 'c3', name: 'Back Yard' },
  { id: 'd4', name: 'Garage' },
  { id: 'e5' }, // no name
]

describe('resolve', () => {
  test('resolves by exact id', () => {
    const r = resolve(fixture, 'b2')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.item.name).toBe('Back Patio')
  })

  test('id match wins over name', () => {
    const r = resolve(fixture, 'a1')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.item.name).toBe('Front Door')
  })

  test('resolves by exact name (case-insensitive)', () => {
    const r = resolve(fixture, 'garage')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.item.id).toBe('d4')
  })

  test('resolves by unique name substring', () => {
    const r = resolve(fixture, 'patio')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.item.id).toBe('b2')
  })

  test('substring matching multiple is ambiguous', () => {
    const r = resolve(fixture, 'back')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.matches.length).toBe(2)
  })

  test('exact name beats substring', () => {
    const coll = [
      { id: '1', name: 'Light' },
      { id: '2', name: 'Light Switch' },
    ]
    const r = resolve(coll, 'Light')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.item.id).toBe('1')
  })

  test('unknown ref is not_found', () => {
    expect(resolve(fixture, 'Nonexistent').kind).toBe('not_found')
  })

  test('empty ref is not_found', () => {
    expect(resolve(fixture, '   ').kind).toBe('not_found')
  })

  test('tolerates entries without a name', () => {
    const r = resolve(fixture, 'e5')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.item.id).toBe('e5')
  })
})
