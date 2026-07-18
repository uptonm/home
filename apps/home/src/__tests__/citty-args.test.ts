import { expect, test } from 'bun:test'
import { argsToCitty } from '../core/citty'

test('positional without required maps to required:false', () => {
  const def = argsToCitty([{ name: 'repo', kind: 'positional', description: 'x' }])
  expect((def.repo as { required?: boolean }).required).toBe(false)
})

test('explicit required survives', () => {
  const def = argsToCitty([{ name: 'room', kind: 'positional', description: 'x', required: true }])
  expect((def.room as { required?: boolean }).required).toBe(true)
})
