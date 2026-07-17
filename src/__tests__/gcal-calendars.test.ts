import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { CalendarsListOptions, CalendarsListResponse } from '../modules/gcal/client'

const CTX = {
  config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  json: true,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {} as Record<string, string | number | boolean | undefined>,
}

let listCalls: CalendarsListOptions[] = []
let listResponse: CalendarsListResponse = { items: [] }

const realClient = await import('../modules/gcal/client')

mock.module('../modules/gcal/client', () => ({
  ...realClient,
  listCalendars: async (_cfg: unknown, opts: CalendarsListOptions = {}) => {
    listCalls.push(opts)
    return listResponse
  },
}))

const { calendarsList } = await import('../modules/gcal/commands/calendars')

afterEach(() => {
  listCalls = []
  listResponse = { items: [] }
})

describe('gcal calendars list', () => {
  test('defaults to maxResults 100', async () => {
    const res = await calendarsList.run({ ...CTX, args: {} })
    expect(res.ok).toBe(true)
    expect(listCalls).toHaveLength(1)
    expect(listCalls[0]).toEqual({ maxResults: 100, pageToken: undefined })
  })

  test('caps max at 250 and rejects a non-positive max', async () => {
    await calendarsList.run({ ...CTX, args: { max: 9999 } })
    expect(listCalls[0]?.maxResults).toBe(250)

    const res = await calendarsList.run({ ...CTX, args: { max: -1 } })
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('bad_arg')
  })

  test('passes page-token through and surfaces nextPageToken', async () => {
    listResponse = { items: [], nextPageToken: 'NPT2' }
    const res = await calendarsList.run({ ...CTX, args: { 'page-token': 'NPT1' } })
    expect(listCalls[0]?.pageToken).toBe('NPT1')
    expect((res as { data?: { nextPageToken?: string } }).data?.nextPageToken).toBe('NPT2')
  })

  test('summarizes entries to id/summary/primary/accessRole/timeZone rows', async () => {
    listResponse = {
      items: [
        { id: 'me@gmail.com', summary: 'me@gmail.com', primary: true, accessRole: 'owner', timeZone: 'America/New_York' },
        { id: 'team@group.calendar.google.com', summary: 'Team', summaryOverride: 'Work team', accessRole: 'reader', timeZone: 'UTC' },
      ],
    }
    const res = await calendarsList.run({ ...CTX, args: {} })
    expect(res.ok).toBe(true)
    expect((res as { data?: { calendars?: unknown } }).data?.calendars).toEqual([
      {
        id: 'me@gmail.com',
        summary: 'me@gmail.com',
        primary: true,
        accessRole: 'owner',
        timeZone: 'America/New_York',
        description: undefined,
      },
      {
        id: 'team@group.calendar.google.com',
        summary: 'Work team',
        primary: false,
        accessRole: 'reader',
        timeZone: 'UTC',
        description: undefined,
      },
    ])
  })
})
