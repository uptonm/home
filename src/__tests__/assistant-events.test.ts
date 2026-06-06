import { describe, expect, mock, test } from 'bun:test'
import type { HassEvent } from '../modules/assistant/client'

const EMPTY_CTX = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

const SAMPLE: HassEvent[] = [
  { event: 'state_changed', listener_count: 5 },
  { event: 'call_service', listener_count: 2 },
]

const realClient = await import('../modules/assistant/client')

mock.module('../modules/assistant/client', () => ({
  ...realClient,
  listEvents: async () => SAMPLE,
}))

const { eventsList } = await import('../modules/assistant/commands/events')

describe('assistant events list', () => {
  test('command path and no args', () => {
    expect(eventsList.path).toEqual(['events', 'list'])
    expect(eventsList.args).toHaveLength(0)
  })

  test('returns the event list', async () => {
    const res = await eventsList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    const data = (res as { data: HassEvent[] }).data
    expect(data).toHaveLength(2)
    expect(data[0]?.event).toBe('state_changed')
  })
})
