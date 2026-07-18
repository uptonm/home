import { expect, test } from 'bun:test'
import { pickField, unwrapItems } from '../../e2e/args'

test('pickField skips rows with empty field', () => {
  expect(pickField([{ name: '' }, { name: 'LAN' }], 'name')).toBe('LAN')
})
test('pickField null on empty list', () => {
  expect(pickField([], 'name')).toBeNull()
})
test('pickField null when field absent everywhere', () => {
  expect(pickField([{ id: 1 }], 'name')).toBeNull()
})
test('unwrapItems pulls named array', () => {
  expect(unwrapItems({ messages: [{ id: 'm1' }], resultSizeEstimate: 5 }, 'messages')).toEqual([
    { id: 'm1' },
  ])
})
test('unwrapItems null when key missing (empty mailbox drops it)', () => {
  expect(unwrapItems({ resultSizeEstimate: 0 }, 'messages')).toBeNull()
})
