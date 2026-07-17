import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { EventsListOptions, EventsListResponse, GcalEvent } from '../modules/gcal/client'

const CTX = {
  config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  json: true,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {} as Record<string, string | number | boolean | undefined>,
}

let listCalls: { calendarId: string; opts: EventsListOptions }[] = []
let getCalls: { calendarId: string; eventId: string }[] = []
let listResponse: EventsListResponse = { items: [] }

const realClient = await import('../modules/gcal/client')

mock.module('../modules/gcal/client', () => ({
  ...realClient,
  listEvents: async (_cfg: unknown, calendarId: string, opts: EventsListOptions = {}) => {
    listCalls.push({ calendarId, opts })
    return listResponse
  },
  getEvent: async (_cfg: unknown, calendarId: string, eventId: string) => {
    getCalls.push({ calendarId, eventId })
    return { id: eventId, summary: 'Standup' }
  },
}))

const { eventsList, eventsGet } = await import('../modules/gcal/commands/events')

afterEach(() => {
  listCalls = []
  getCalls = []
  listResponse = { items: [] }
})

describe('gcal events list', () => {
  test('defaults to the primary calendar and maxResults 25', async () => {
    const res = await eventsList.run({ ...CTX, args: {} })
    expect(res.ok).toBe(true)
    expect(listCalls).toHaveLength(1)
    expect(listCalls[0]).toEqual({
      calendarId: 'primary',
      opts: { timeMin: undefined, timeMax: undefined, q: undefined, maxResults: 25, pageToken: undefined },
    })
  })

  test('passes calendarId, RFC 3339 bounds, q, and page-token through', async () => {
    const res = await eventsList.run({
      ...CTX,
      args: {
        calendarId: 'team@group.calendar.google.com',
        from: '2026-07-17T09:00:00Z',
        to: '2026-07-24T09:00:00Z',
        q: 'standup',
        max: 10,
        'page-token': 'NPT',
      },
    })
    expect(res.ok).toBe(true)
    expect(listCalls[0]).toEqual({
      calendarId: 'team@group.calendar.google.com',
      opts: {
        timeMin: '2026-07-17T09:00:00Z',
        timeMax: '2026-07-24T09:00:00Z',
        q: 'standup',
        maxResults: 10,
        pageToken: 'NPT',
      },
    })
  })

  test('expands a bare YYYY-MM-DD lower bound to local midnight', async () => {
    await eventsList.run({ ...CTX, args: { from: '2026-07-17' } })
    expect(listCalls[0]?.opts.timeMin).toBe(new Date(2026, 6, 17).toISOString())
  })

  test('expands a bare YYYY-MM-DD --to to the start of the next day so the named day is included', async () => {
    await eventsList.run({ ...CTX, args: { to: '2026-07-24' } })
    // timeMax is exclusive on event start; an event at 2026-07-24T23:00 must still fall inside.
    expect(listCalls[0]?.opts.timeMax).toBe(new Date(2026, 6, 25).toISOString())
    expect(new Date('2026-07-24T23:00:00').getTime()).toBeLessThan(
      new Date(listCalls[0]!.opts.timeMax!).getTime(),
    )
  })

  test('rejects an unparseable time bound', async () => {
    const res = await eventsList.run({ ...CTX, args: { from: 'next tuesday' } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
    expect(listCalls).toHaveLength(0)
  })

  test('caps max at 2500 and rejects a non-positive max', async () => {
    await eventsList.run({ ...CTX, args: { max: 99999 } })
    expect(listCalls[0]?.opts.maxResults).toBe(2500)

    const res = await eventsList.run({ ...CTX, args: { max: 0 } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
  })

  test('normalizes events and surfaces the pagination boundary', async () => {
    const items: GcalEvent[] = [
      {
        id: 'ev1',
        status: 'confirmed',
        summary: 'Vacation',
        start: { date: '2026-07-20' },
        end: { date: '2026-07-21' },
      },
      {
        id: 'ev2_20260717T130000Z',
        status: 'confirmed',
        summary: 'Weekly sync',
        start: { dateTime: '2026-07-17T13:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-07-17T13:30:00Z', timeZone: 'UTC' },
        recurringEventId: 'ev2',
        originalStartTime: { dateTime: '2026-07-17T13:00:00Z' },
      },
    ]
    listResponse = { summary: 'Personal', timeZone: 'America/New_York', items, nextPageToken: 'NPT' }

    const res = await eventsList.run({ ...CTX, args: {} })
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.calendarId).toBe('primary')
    expect(data.calendarSummary).toBe('Personal')
    expect(data.timeZone).toBe('America/New_York')
    expect(data.nextPageToken).toBe('NPT')
    expect(data.events).toEqual([
      {
        id: 'ev1',
        summary: 'Vacation',
        status: 'confirmed',
        start: '2026-07-20',
        // Google's all-day end.date (2026-07-21) is exclusive; collapsed to the inclusive last day.
        end: '2026-07-20',
        allDay: true,
        timeZone: undefined,
        location: undefined,
        organizer: undefined,
        recurringEventId: undefined,
        originalStart: undefined,
      },
      {
        id: 'ev2_20260717T130000Z',
        summary: 'Weekly sync',
        status: 'confirmed',
        start: '2026-07-17T13:00:00Z',
        end: '2026-07-17T13:30:00Z',
        allDay: false,
        timeZone: 'UTC',
        location: undefined,
        organizer: undefined,
        recurringEventId: 'ev2',
        originalStart: '2026-07-17T13:00:00Z',
      },
    ])
  })
})

describe('gcal events get', () => {
  test('requires calendarId and eventId', async () => {
    const missingBoth = await eventsGet.run({ ...CTX, args: {} })
    expect(missingBoth.ok).toBe(false)
    expect((missingBoth as { code?: string }).code).toBe('missing_arg')

    const missingEvent = await eventsGet.run({ ...CTX, args: { calendarId: 'primary' } })
    expect(missingEvent.ok).toBe(false)
    expect((missingEvent as { code?: string }).code).toBe('missing_arg')
    expect(getCalls).toHaveLength(0)
  })

  test('passes both ids through and returns the full payload', async () => {
    const res = await eventsGet.run({ ...CTX, args: { calendarId: 'primary', eventId: 'ev1' } })
    expect(res.ok).toBe(true)
    expect(getCalls[0]).toEqual({ calendarId: 'primary', eventId: 'ev1' })
    expect((res as { data?: unknown }).data).toEqual({ id: 'ev1', summary: 'Standup' })
  })
})
