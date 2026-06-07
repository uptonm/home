import { describe, expect, mock, test } from 'bun:test'
import type { HassState } from '../modules/assistant/client'

const EMPTY_CTX = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

const realClient = await import('../modules/assistant/client')

let lastSetState: { entity?: string; state?: string; attributes?: Record<string, unknown> } = {}

mock.module('../modules/assistant/client', () => ({
  ...realClient,
  setState: async (_cfg: unknown, entity: string, state: string, attributes?: Record<string, unknown>) => {
    lastSetState = { entity, state, attributes }
    return { entity_id: entity, state, attributes: attributes ?? {} } as HassState
  },
}))

const { stateSet } = await import('../modules/assistant/commands/states')

describe('assistant state set', () => {
  test('command path and confirm flag', () => {
    expect(stateSet.path).toEqual(['state', 'set'])
    expect(stateSet.args.find((a) => a.name === 'confirm')?.kind).toBe('boolean')
  })

  test('rejects missing entity', async () => {
    expect(errCode(await stateSet.run({ ...EMPTY_CTX, args: { state: '1', confirm: true } }))).toBe('missing_arg')
  })

  test('rejects missing state', async () => {
    expect(errCode(await stateSet.run({ ...EMPTY_CTX, args: { entity: 'sensor.x', confirm: true } }))).toBe('missing_arg')
  })

  test('guards the write without --confirm', async () => {
    const res = await stateSet.run({ ...EMPTY_CTX, args: { entity: 'sensor.x', state: '42' } })
    expect(errCode(res)).toBe('confirmation_required')
  })

  test('rejects invalid --attributes JSON', async () => {
    const res = await stateSet.run({ ...EMPTY_CTX, args: { entity: 'sensor.x', state: '42', confirm: true, attributes: '{bad' } })
    expect(errCode(res)).toBe('bad_json')
  })

  test('writes when confirmed and forwards parsed attributes', async () => {
    const res = await stateSet.run({
      ...EMPTY_CTX,
      args: { entity: 'sensor.x', state: '42', confirm: true, attributes: '{"unit_of_measurement":"°C"}' },
    })
    expect(res.ok).toBe(true)
    expect(lastSetState).toEqual({ entity: 'sensor.x', state: '42', attributes: { unit_of_measurement: '°C' } })
    expect((res as { data: HassState }).data.entity_id).toBe('sensor.x')
  })
})
