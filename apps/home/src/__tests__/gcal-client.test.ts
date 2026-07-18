import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetGoogleTokenCache } from '../core/google-auth'
import {
  GCAL_API_BASE,
  calendarListEntryUrl,
  calendarsListUrl,
  checkGcalStatus,
  eventGetUrl,
  eventsListUrl,
  freeBusyBody,
  freeBusyUrl,
  getEvent,
  listCalendars,
  queryFreeBusy,
  summarizeCalendar,
  summarizeEvent,
  summarizeFreeBusy,
  type GcalEvent,
} from '../modules/gcal/client'

describe('calendarsListUrl', () => {
  test('no options → bare endpoint', () => {
    expect(calendarsListUrl()).toBe(`${GCAL_API_BASE}/users/me/calendarList`)
  })

  test('sets maxResults and pageToken', () => {
    const u = new URL(calendarsListUrl({ maxResults: 1, pageToken: 'NPT' }))
    expect(u.pathname).toBe('/calendar/v3/users/me/calendarList')
    expect(u.searchParams.get('maxResults')).toBe('1')
    expect(u.searchParams.get('pageToken')).toBe('NPT')
  })
})

describe('calendarListEntryUrl', () => {
  test('URL-encodes the calendar id', () => {
    expect(calendarListEntryUrl('primary')).toBe(`${GCAL_API_BASE}/users/me/calendarList/primary`)
    expect(calendarListEntryUrl('team@group.calendar.google.com')).toContain(
      '/calendarList/team%40group.calendar.google.com',
    )
  })
})

describe('eventsListUrl', () => {
  test('always expands recurring events and orders by start time', () => {
    const u = new URL(eventsListUrl('primary'))
    expect(u.pathname).toBe('/calendar/v3/calendars/primary/events')
    expect(u.searchParams.get('singleEvents')).toBe('true')
    expect(u.searchParams.get('orderBy')).toBe('startTime')
  })

  test('sets timeMin/timeMax/q/maxResults/pageToken', () => {
    const u = new URL(
      eventsListUrl('primary', {
        timeMin: '2026-07-17T00:00:00Z',
        timeMax: '2026-07-24T00:00:00Z',
        q: 'team standup',
        maxResults: 25,
        pageToken: 'NPT',
      }),
    )
    expect(u.searchParams.get('timeMin')).toBe('2026-07-17T00:00:00Z')
    expect(u.searchParams.get('timeMax')).toBe('2026-07-24T00:00:00Z')
    expect(u.searchParams.get('q')).toBe('team standup')
    expect(u.searchParams.get('maxResults')).toBe('25')
    expect(u.searchParams.get('pageToken')).toBe('NPT')
    expect(eventsListUrl('primary', { q: 'a b' })).not.toContain(' ')
  })

  test('omits unset bounds and URL-encodes the calendar id', () => {
    const u = new URL(eventsListUrl('team@group.calendar.google.com'))
    expect(u.searchParams.has('timeMin')).toBe(false)
    expect(u.searchParams.has('timeMax')).toBe(false)
    expect(u.searchParams.has('q')).toBe(false)
    expect(u.pathname).toBe('/calendar/v3/calendars/team%40group.calendar.google.com/events')
  })
})

describe('eventGetUrl', () => {
  test('URL-encodes both ids', () => {
    expect(eventGetUrl('primary', 'ev1')).toBe(`${GCAL_API_BASE}/calendars/primary/events/ev1`)
    expect(eventGetUrl('a@b.com', 'e/1')).toContain('/calendars/a%40b.com/events/e%2F1')
  })
})

describe('freeBusyBody', () => {
  test('maps the range to timeMin/timeMax and calendar ids to items', () => {
    expect(freeBusyBody('2026-07-17T09:00:00Z', '2026-07-17T17:00:00Z', ['primary', 'a@b.com'])).toEqual({
      timeMin: '2026-07-17T09:00:00Z',
      timeMax: '2026-07-17T17:00:00Z',
      items: [{ id: 'primary' }, { id: 'a@b.com' }],
    })
  })
})

describe('summarizeFreeBusy', () => {
  test('flattens the calendars map, defaulting busy and errors to empty arrays', () => {
    expect(
      summarizeFreeBusy({
        calendars: {
          primary: { busy: [{ start: '2026-07-17T13:00:00Z', end: '2026-07-17T13:30:00Z' }] },
          'nope@example.com': { errors: [{ domain: 'global', reason: 'notFound' }] },
        },
      }),
    ).toEqual([
      {
        calendarId: 'primary',
        busy: [{ start: '2026-07-17T13:00:00Z', end: '2026-07-17T13:30:00Z' }],
        errors: [],
      },
      { calendarId: 'nope@example.com', busy: [], errors: [{ domain: 'global', reason: 'notFound' }] },
    ])
  })

  test('tolerates a response with no calendars map', () => {
    expect(summarizeFreeBusy({})).toEqual([])
  })
})

describe('summarizeCalendar', () => {
  test('keeps id/accessRole/timeZone and defaults primary to false', () => {
    expect(
      summarizeCalendar({ id: 'a@b.com', summary: 'Personal', accessRole: 'owner', timeZone: 'America/New_York' }),
    ).toEqual({
      id: 'a@b.com',
      summary: 'Personal',
      primary: false,
      accessRole: 'owner',
      timeZone: 'America/New_York',
      description: undefined,
    })
  })

  test('primary flag survives and summaryOverride wins over summary', () => {
    const row = summarizeCalendar({
      id: 'a@b.com',
      summary: 'a@b.com',
      summaryOverride: 'Me',
      primary: true,
      accessRole: 'owner',
    })
    expect(row.primary).toBe(true)
    expect(row.summary).toBe('Me')
  })
})

describe('summarizeEvent', () => {
  test('timed event: dateTime + timeZone, not all-day', () => {
    const event: GcalEvent = {
      id: 'ev1',
      status: 'confirmed',
      summary: 'Standup',
      location: 'Meet',
      organizer: { email: 'boss@example.com', displayName: 'Boss' },
      start: { dateTime: '2026-07-17T09:00:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-07-17T09:15:00-04:00', timeZone: 'America/New_York' },
    }
    expect(summarizeEvent(event)).toEqual({
      id: 'ev1',
      summary: 'Standup',
      status: 'confirmed',
      start: '2026-07-17T09:00:00-04:00',
      end: '2026-07-17T09:15:00-04:00',
      allDay: false,
      timeZone: 'America/New_York',
      location: 'Meet',
      organizer: 'Boss',
      recurringEventId: undefined,
      originalStart: undefined,
    })
  })

  test('all-day event: bare date, allDay true, exclusive end collapsed to the inclusive last day', () => {
    // One-day event: Google end.date 2026-07-21 is exclusive → inclusive last day 2026-07-20.
    const row = summarizeEvent({
      id: 'ev2',
      summary: 'Vacation',
      start: { date: '2026-07-20' },
      end: { date: '2026-07-21' },
    })
    expect(row.allDay).toBe(true)
    expect(row.start).toBe('2026-07-20')
    expect(row.end).toBe('2026-07-20')
    expect(row.timeZone).toBeUndefined()
  })

  test('multi-day all-day event: end is the inclusive last day, across a month boundary', () => {
    // Jul 17 → Aug 01 exclusive spans Jul 17–31 inclusive; the collapse must not underflow the month.
    const row = summarizeEvent({ id: 'ev2b', start: { date: '2026-07-17' }, end: { date: '2026-08-01' } })
    expect(row.start).toBe('2026-07-17')
    expect(row.end).toBe('2026-07-31')
  })

  test('recurring instance carries parent id and original slot', () => {
    const row = summarizeEvent({
      id: 'ev3_20260717T130000Z',
      summary: 'Weekly sync',
      start: { dateTime: '2026-07-17T13:00:00Z' },
      end: { dateTime: '2026-07-17T13:30:00Z' },
      recurringEventId: 'ev3',
      originalStartTime: { dateTime: '2026-07-17T13:00:00Z' },
    })
    expect(row.recurringEventId).toBe('ev3')
    expect(row.originalStart).toBe('2026-07-17T13:00:00Z')
  })

  test('organizer falls back to email; tolerates an event with only an id', () => {
    expect(summarizeEvent({ id: 'ev4', organizer: { email: 'x@y.com' } }).organizer).toBe('x@y.com')
    expect(summarizeEvent({ id: 'ev5' })).toEqual({
      id: 'ev5',
      summary: undefined,
      status: undefined,
      start: undefined,
      end: undefined,
      allDay: false,
      timeZone: undefined,
      location: undefined,
      organizer: undefined,
      recurringEventId: undefined,
      originalStart: undefined,
    })
  })
})

describe('network functions over mocked fetch', () => {
  const cfg = { clientId: 'c', clientSecret: 's', refreshToken: 'r' }
  const originalFetch = globalThis.fetch

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const tokenResponse = () => jsonResponse({ access_token: 'tok', expires_in: 3600 })

  beforeEach(() => resetGoogleTokenCache())
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetGoogleTokenCache()
  })

  test('getEvent hits the per-event endpoint with a bearer token', async () => {
    let seenUrl = ''
    let seenAuth: string | undefined
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com')) return tokenResponse()
      seenUrl = String(url)
      seenAuth = (init?.headers as Record<string, string>)?.Authorization
      return jsonResponse({ id: 'ev1', summary: 'Standup' })
    }) as typeof fetch

    const event = await getEvent(cfg, 'primary', 'ev1')
    expect(event).toEqual({ id: 'ev1', summary: 'Standup' })
    expect(seenUrl).toBe(`${GCAL_API_BASE}/calendars/primary/events/ev1`)
    expect(seenAuth).toBe('Bearer tok')
  })

  test('queryFreeBusy POSTs the JSON body to the freeBusy endpoint', async () => {
    let seenUrl = ''
    let seenMethod: string | undefined
    let seenHeaders: Record<string, string> = {}
    let seenBody: unknown
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com')) return tokenResponse()
      seenUrl = String(url)
      seenMethod = init?.method
      seenHeaders = (init?.headers as Record<string, string>) ?? {}
      seenBody = JSON.parse(String(init?.body))
      return jsonResponse({ calendars: { primary: { busy: [] } } })
    }) as typeof fetch

    const body = freeBusyBody('2026-07-17T09:00:00Z', '2026-07-17T17:00:00Z', ['primary'])
    const res = await queryFreeBusy(cfg, body)
    expect(res).toEqual({ calendars: { primary: { busy: [] } } })
    expect(seenUrl).toBe(freeBusyUrl())
    expect(seenUrl).toBe(`${GCAL_API_BASE}/freeBusy`)
    expect(seenMethod).toBe('POST')
    expect(seenHeaders['Content-Type']).toBe('application/json')
    expect(seenHeaders.Authorization).toBe('Bearer tok')
    expect(seenBody).toEqual(body)
  })

  test('listCalendars surfaces the nextPageToken pagination boundary', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('oauth2.googleapis.com')) return tokenResponse()
      const u = new URL(String(url))
      expect(u.searchParams.get('maxResults')).toBe('1')
      return jsonResponse({ items: [{ id: 'a@b.com', primary: true }], nextPageToken: 'NPT' })
    }) as typeof fetch

    const page = await listCalendars(cfg, { maxResults: 1 })
    expect(page.items).toEqual([{ id: 'a@b.com', primary: true }])
    expect(page.nextPageToken).toBe('NPT')
  })

  describe('checkGcalStatus error normalization', () => {
    test('working grant → authenticated account from the primary entry', async () => {
      globalThis.fetch = (async (url: string) => {
        if (String(url).includes('oauth2.googleapis.com')) return tokenResponse()
        expect(String(url)).toBe(`${GCAL_API_BASE}/users/me/calendarList/primary`)
        return jsonResponse({ id: 'me@gmail.com', primary: true, timeZone: 'America/New_York' })
      }) as typeof fetch

      expect(await checkGcalStatus({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })).toEqual({
        ok: true,
        data: { status: 'authenticated', account: 'me@gmail.com', timeZone: 'America/New_York' },
      })
    })

    test('rejected refresh grant → auth_failed', async () => {
      globalThis.fetch = (async (url: string) => {
        if (String(url).includes('oauth2.googleapis.com')) {
          return jsonResponse({ error: 'invalid_grant' }, 400)
        }
        return jsonResponse({}, 200)
      }) as typeof fetch

      const res = await checkGcalStatus({ clientId: 'c', clientSecret: 's', refreshToken: 'revoked' })
      expect(res.ok).toBe(false)
      expect((res as { code?: string }).code).toBe('auth_failed')
    })

    test('API 401 (even after the retry-once) → auth_failed', async () => {
      globalThis.fetch = (async (url: string) => {
        if (String(url).includes('oauth2.googleapis.com')) return tokenResponse()
        return jsonResponse({ error: { code: 401 } }, 401)
      }) as typeof fetch

      const res = await checkGcalStatus({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })
      expect(res.ok).toBe(false)
      expect((res as { code?: string }).code).toBe('auth_failed')
    })

    test('API 5xx → upstream_failed', async () => {
      globalThis.fetch = (async (url: string) => {
        if (String(url).includes('oauth2.googleapis.com')) return tokenResponse()
        return jsonResponse({ error: { code: 503 } }, 503)
      }) as typeof fetch

      const res = await checkGcalStatus({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })
      expect(res.ok).toBe(false)
      expect((res as { code?: string }).code).toBe('upstream_failed')
    })
  })
})
