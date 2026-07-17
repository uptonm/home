import { afterEach, describe, expect, mock, test } from 'bun:test'
import type {
  CalendarsListOptions,
  CalendarsListResponse,
  EventsListOptions,
  EventsListResponse,
} from '../modules/gcal/client'

const CTX = {
  config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  json: true,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {} as Record<string, string | number | boolean | undefined>,
}

const DAY_MS = 24 * 60 * 60 * 1000

let calendarsCalls: CalendarsListOptions[] = []
let calendarsResponse: CalendarsListResponse = { items: [{ id: 'primary-cal', summary: 'Personal', primary: true }] }
let eventsCalls: { calendarId: string; opts: EventsListOptions }[] = []
let eventsResponses: Record<string, EventsListResponse> = {}

const realClient = await import('../modules/gcal/client')

mock.module('../modules/gcal/client', () => ({
  ...realClient,
  listCalendars: async (_cfg: unknown, opts: CalendarsListOptions = {}) => {
    calendarsCalls.push(opts)
    return calendarsResponse
  },
  listEvents: async (_cfg: unknown, calendarId: string, opts: EventsListOptions = {}) => {
    eventsCalls.push({ calendarId, opts })
    return eventsResponses[calendarId] ?? { items: [] }
  },
}))

const { agenda, mergeAgenda } = await import('../modules/gcal/commands/agenda')

afterEach(() => {
  calendarsCalls = []
  calendarsResponse = { items: [{ id: 'primary-cal', summary: 'Personal', primary: true }] }
  eventsCalls = []
  eventsResponses = {}
})

describe('mergeAgenda', () => {
  test('interleaves calendars strictly chronologically by absolute instant across time zones', () => {
    const rows = mergeAgenda([
      {
        calendarId: 'work',
        calendarSummary: 'Work',
        events: [
          // 12:15Z
          { id: 'noon-utc', summary: 'Noon-ish UTC', start: { dateTime: '2026-07-17T12:15:00Z' }, end: { dateTime: '2026-07-17T12:45:00Z' } },
          // 13:30Z despite the latest wall-clock time
          { id: 'nyc', summary: 'NYC morning', start: { dateTime: '2026-07-17T09:30:00-04:00' }, end: { dateTime: '2026-07-17T10:00:00-04:00' } },
        ],
      },
      {
        calendarId: 'personal',
        calendarSummary: 'Personal',
        events: [
          // 13:00Z despite the earliest wall-clock afternoon
          { id: 'berlin', summary: 'Berlin afternoon', start: { dateTime: '2026-07-17T15:00:00+02:00' }, end: { dateTime: '2026-07-17T15:30:00+02:00' } },
        ],
      },
    ])
    expect(rows.map((r) => r.id)).toEqual(['noon-utc', 'berlin', 'nyc'])
    expect(rows.map((r) => r.calendarId)).toEqual(['work', 'personal', 'work'])
  })

  test('all-day events sort ahead of timed events on the same day', () => {
    const rows = mergeAgenda([
      {
        calendarId: 'work',
        events: [
          // Local midnight exactly — ties with the all-day sort key
          { id: 'midnight', summary: 'Midnight kickoff', start: { dateTime: new Date(2026, 6, 17).toISOString() }, end: { dateTime: new Date(2026, 6, 17, 1).toISOString() } },
          { id: 'afternoon', summary: 'Afternoon sync', start: { dateTime: '2026-07-17T15:00:00Z' }, end: { dateTime: '2026-07-17T15:30:00Z' } },
        ],
      },
      {
        calendarId: 'personal',
        events: [{ id: 'vacation', summary: 'Vacation', start: { date: '2026-07-17' }, end: { date: '2026-07-18' } }],
      },
    ])
    expect(rows.map((r) => r.id)).toEqual(['vacation', 'midnight', 'afternoon'])
    expect(rows[0]).toEqual({
      calendarId: 'personal',
      calendarSummary: undefined,
      id: 'vacation',
      summary: 'Vacation',
      start: '2026-07-17',
      end: '2026-07-18',
      allDay: true,
      location: undefined,
    })
  })

  test('DST fall-back boundary: offsets pass through verbatim and ordering honors them', () => {
    const rows = mergeAgenda([
      {
        calendarId: 'work',
        events: [
          // 06:00Z — later instant despite the earlier wall-clock time
          { id: 'after', summary: 'Post-transition', start: { dateTime: '2026-11-01T01:00:00-05:00' }, end: { dateTime: '2026-11-01T02:00:00-05:00' } },
          // 05:30Z; the event itself spans the transition (-04:00 → -05:00)
          { id: 'spanning', summary: 'Spans fall-back', start: { dateTime: '2026-11-01T01:30:00-04:00' }, end: { dateTime: '2026-11-01T01:30:00-05:00' } },
        ],
      },
    ])
    expect(rows.map((r) => r.id)).toEqual(['spanning', 'after'])
    expect(rows[0]?.start).toBe('2026-11-01T01:30:00-04:00')
    expect(rows[0]?.end).toBe('2026-11-01T01:30:00-05:00')
  })
})

describe('gcal agenda', () => {
  test('defaults: all calendars on the account, a 1-day window, maxResults 50', async () => {
    calendarsResponse = {
      items: [
        { id: 'a@b.com', summary: 'a@b.com', summaryOverride: 'Mine', primary: true },
        { id: 'team@group.calendar.google.com', summary: 'Team' },
        { id: 'gone@b.com', summary: 'Gone', deleted: true },
      ],
    }
    eventsResponses = {
      'a@b.com': { items: [{ id: 'ev1', summary: 'Standup', start: { dateTime: '2026-07-17T13:00:00Z' }, end: { dateTime: '2026-07-17T13:15:00Z' } }] },
    }

    const res = await agenda.run({ ...CTX, args: {} })
    expect(res.ok).toBe(true)
    expect(calendarsCalls).toEqual([{ maxResults: 250 }])
    expect(eventsCalls.map((c) => c.calendarId)).toEqual(['a@b.com', 'team@group.calendar.google.com'])

    const opts = eventsCalls[0]!.opts
    expect(opts.maxResults).toBe(50)
    expect(Date.parse(opts.timeMax!) - Date.parse(opts.timeMin!)).toBe(DAY_MS)

    const data = (res as { data: Record<string, unknown> }).data
    expect(data.days).toBe(1)
    expect(data.calendars).toEqual(['a@b.com', 'team@group.calendar.google.com'])
    expect(data.truncated).toBe(false)
    expect(data.events).toEqual([
      {
        calendarId: 'a@b.com',
        calendarSummary: 'Mine',
        id: 'ev1',
        summary: 'Standup',
        start: '2026-07-17T13:00:00Z',
        end: '2026-07-17T13:15:00Z',
        allDay: false,
        location: undefined,
      },
    ])
  })

  test('caps --days at 14 and rejects a non-positive --days', async () => {
    await agenda.run({ ...CTX, args: { days: 99, calendars: 'primary' } })
    const opts = eventsCalls[0]!.opts
    expect(Date.parse(opts.timeMax!) - Date.parse(opts.timeMin!)).toBe(14 * DAY_MS)

    const res = await agenda.run({ ...CTX, args: { days: 0 } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(calendarsCalls).toHaveLength(0)
  })

  test('--calendars skips the calendar-list fan-out and queries exactly the given ids', async () => {
    const res = await agenda.run({ ...CTX, args: { calendars: 'primary, team@group.calendar.google.com' } })
    expect(res.ok).toBe(true)
    expect(calendarsCalls).toHaveLength(0)
    expect(eventsCalls.map((c) => c.calendarId)).toEqual(['primary', 'team@group.calendar.google.com'])
  })

  test('bounds total rows at --max with a truncation flag', async () => {
    eventsResponses = {
      primary: {
        items: [
          { id: 'e1', start: { dateTime: '2026-07-17T13:00:00Z' }, end: { dateTime: '2026-07-17T14:00:00Z' } },
          { id: 'e2', start: { dateTime: '2026-07-17T15:00:00Z' }, end: { dateTime: '2026-07-17T16:00:00Z' } },
          { id: 'e3', start: { dateTime: '2026-07-17T17:00:00Z' }, end: { dateTime: '2026-07-17T18:00:00Z' } },
        ],
      },
    }
    const res = await agenda.run({ ...CTX, args: { calendars: 'primary', max: 2 } })
    const data = (res as { data: { events: unknown[]; truncated: boolean } }).data
    expect(data.events).toHaveLength(2)
    expect(data.truncated).toBe(true)
  })

  test('a calendar with more pages upstream flags truncation even under --max', async () => {
    eventsResponses = {
      primary: {
        items: [{ id: 'e1', start: { dateTime: '2026-07-17T13:00:00Z' }, end: { dateTime: '2026-07-17T14:00:00Z' } }],
        nextPageToken: 'NPT',
      },
    }
    const res = await agenda.run({ ...CTX, args: { calendars: 'primary' } })
    expect((res as { data: { truncated: boolean } }).data.truncated).toBe(true)
  })

  test('falls back to primary when the account has no listed calendars', async () => {
    calendarsResponse = { items: [] }
    const res = await agenda.run({ ...CTX, args: {} })
    expect(res.ok).toBe(true)
    expect(eventsCalls.map((c) => c.calendarId)).toEqual(['primary'])
  })
})
