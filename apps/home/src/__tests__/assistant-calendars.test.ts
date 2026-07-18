import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { HassCalendar } from '../modules/assistant/client'

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

const CALENDARS: HassCalendar[] = [
  { entity_id: 'calendar.personal', name: 'Personal' },
  { entity_id: 'calendar.holidays', name: 'Holidays' },
]

const EVENTS = [{ summary: 'Cinema', start: { dateTime: '2026-06-10T19:00:00Z' }, end: { dateTime: '2026-06-10T21:00:00Z' } }]

const realClient = await import('../modules/assistant/client')

// Store the real listCalendars before mocking
const realListCalendars = realClient.listCalendars

// Capture the args getCalendar is called with so we can assert the window.
let lastGetCalendarArgs: { entity?: string; start?: string; end?: string } = {}

mock.module('../modules/assistant/client', () => ({
  ...realClient,
  listCalendars: async () => CALENDARS,
  getCalendar: async (_cfg: unknown, entity: string, start: string, end: string) => {
    lastGetCalendarArgs = { entity, start, end }
    return EVENTS
  },
}))

const { calendarsList, calendarsGet, parseCalendarPoint, resolveCalendarWindow } = await import(
  '../modules/assistant/commands/calendars'
)

const NOW = Date.parse('2026-06-05T00:00:00.000Z')

describe('listCalendars', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns empty array on 404 (no calendar integration)', async () => {
    globalThis.fetch = (async (_url: string, _init?: RequestInit) => new Response('', { status: 404 })) as typeof fetch
    const result = await realListCalendars({ url: 'http://localhost:8123', token: 'token' })
    expect(result).toEqual([])
  })
})

describe('parseCalendarPoint', () => {
  test('returns null for empty', () => {
    expect(parseCalendarPoint(undefined, NOW)).toBeNull()
    expect(parseCalendarPoint('', NOW)).toBeNull()
  })
  test('parses an ISO timestamp', () => {
    expect(parseCalendarPoint('2026-06-10T00:00:00Z', NOW)).toBe(Date.parse('2026-06-10T00:00:00Z'))
  })
  test('parses a positive relative duration as future offset', () => {
    expect(parseCalendarPoint('7d', NOW)).toBe(NOW + 7 * 86_400_000)
  })
  test('parses a negative relative duration as past offset', () => {
    expect(parseCalendarPoint('-1d', NOW)).toBe(NOW - 86_400_000)
  })
  test('returns null for garbage', () => {
    expect(parseCalendarPoint('not-a-date', NOW)).toBeNull()
  })
})

describe('resolveCalendarWindow', () => {
  test('defaults: start = now, end = now + 7d', () => {
    const w = resolveCalendarWindow(undefined, undefined, NOW)
    expect(w.start).toBe(new Date(NOW).toISOString())
    expect(w.end).toBe(new Date(NOW + 7 * 86_400_000).toISOString())
  })
  test('end defaults to start + 7d when only start given', () => {
    const w = resolveCalendarWindow('2026-06-10T00:00:00Z', undefined, NOW)
    const startMs = Date.parse('2026-06-10T00:00:00Z')
    expect(w.start).toBe(new Date(startMs).toISOString())
    expect(w.end).toBe(new Date(startMs + 7 * 86_400_000).toISOString())
  })
  test('relative end is offset from now', () => {
    const w = resolveCalendarWindow(undefined, '30d', NOW)
    expect(w.end).toBe(new Date(NOW + 30 * 86_400_000).toISOString())
  })
})

describe('assistant calendars list', () => {
  test('command path', () => {
    expect(calendarsList.path).toEqual(['calendars', 'list'])
  })
  test('returns the calendar list', async () => {
    const res = await calendarsList.run({ ...EMPTY_CTX })
    expect(res.ok).toBe(true)
    expect((res as { data: HassCalendar[] }).data).toHaveLength(2)
  })
})

describe('assistant calendars get', () => {
  test('command path and required entity', () => {
    expect(calendarsGet.path).toEqual(['calendars', 'get'])
    expect(calendarsGet.args.find((a) => a.name === 'entity')?.required).toBe(true)
  })
  test('rejects missing entity', async () => {
    expect(errCode(await calendarsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })
  test('forwards entity and a resolved window to getCalendar', async () => {
    const res = await calendarsGet.run({ ...EMPTY_CTX, args: { entity: 'calendar.personal' } })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown[] }).data).toEqual(EVENTS)
    expect(lastGetCalendarArgs.entity).toBe('calendar.personal')
    // both window bounds are ISO strings
    expect(() => new Date(lastGetCalendarArgs.start!).toISOString()).not.toThrow()
    expect(() => new Date(lastGetCalendarArgs.end!).toISOString()).not.toThrow()
  })
})
