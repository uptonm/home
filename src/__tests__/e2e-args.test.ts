import { expect, test } from 'bun:test'
import { pickField } from '../../e2e/args'

test('pickField skips rows with empty field', () => {
  expect(pickField([{ name: '' }, { name: 'LAN' }], 'name')).toBe('LAN')
})
test('pickField null on empty list', () => {
  expect(pickField([], 'name')).toBeNull()
})
test('pickField null when field absent everywhere', () => {
  expect(pickField([{ id: 1 }], 'name')).toBeNull()
})
