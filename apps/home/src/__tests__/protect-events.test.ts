import { describe, expect, mock, test } from 'bun:test'

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

const EVENTS = [
  { id: 'e1', type: 'motion', camera: 'cam1', start: 1000 },
  { id: 'e2', type: 'smartDetectZone', camera: 'cam1', smartDetectTypes: ['person'], start: 2000 },
]

const realClient = await import('../modules/protect/client')

mock.module('../modules/protect/client', () => ({
  ...realClient,
  getEvents: async () => EVENTS,
  getEvent: async (_cfg: unknown, id: string) => EVENTS.find((e) => e.id === id) ?? null,
}))

const { eventsGet, eventsList } = await import('../modules/protect/commands/events')

describe('protect events list', () => {
  test('returns events newest-first', async () => {
    const res = await eventsList.run({ ...EMPTY_CTX, args: { since: '1h', limit: 50 } })
    expect(res.ok).toBe(true)
    const data = (res as { data: Array<{ id: string }> }).data
    expect(data[0]?.id).toBe('e2')
  })
})

describe('protect events get', () => {
  test('rejects missing id', async () => {
    expect(errCode(await eventsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('returns the matching event', async () => {
    const res = await eventsGet.run({ ...EMPTY_CTX, args: { id: 'e1' } })
    expect(res.ok).toBe(true)
    expect((res as { data: { id: string } }).data.id).toBe('e1')
  })

  test('unknown id is not_found', async () => {
    expect(errCode(await eventsGet.run({ ...EMPTY_CTX, args: { id: 'nope' } }))).toBe('not_found')
  })

  test('declares expected path', () => {
    expect(eventsGet.path).toEqual(['events', 'get'])
  })
})
