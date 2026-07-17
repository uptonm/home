import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { FreeBusyRequestBody, FreeBusyResponse } from '../modules/gcal/client'

const CTX = {
  config: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  json: true,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {} as Record<string, string | number | boolean | undefined>,
}

let queryCalls: FreeBusyRequestBody[] = []
let queryResponse: FreeBusyResponse = { calendars: {} }

const realClient = await import('../modules/gcal/client')

mock.module('../modules/gcal/client', () => ({
  ...realClient,
  queryFreeBusy: async (_cfg: unknown, body: FreeBusyRequestBody) => {
    queryCalls.push(body)
    return queryResponse
  },
}))

const { freebusy } = await import('../modules/gcal/commands/freebusy')

afterEach(() => {
  queryCalls = []
  queryResponse = { calendars: {} }
})

describe('gcal freebusy', () => {
  test('builds the request body from --from/--to/--calendars', async () => {
    const res = await freebusy.run({
      ...CTX,
      args: {
        from: '2026-07-17T09:00:00Z',
        to: '2026-07-17T17:00:00Z',
        calendars: 'primary, team@group.calendar.google.com',
      },
    })
    expect(res.ok).toBe(true)
    expect(queryCalls).toEqual([
      {
        timeMin: '2026-07-17T09:00:00Z',
        timeMax: '2026-07-17T17:00:00Z',
        items: [{ id: 'primary' }, { id: 'team@group.calendar.google.com' }],
      },
    ])
  })

  test('defaults to the primary calendar and expands bare dates to local midnight', async () => {
    await freebusy.run({ ...CTX, args: { from: '2026-07-17', to: '2026-07-18' } })
    expect(queryCalls[0]).toEqual({
      timeMin: new Date(2026, 6, 17).toISOString(),
      timeMax: new Date(2026, 6, 18).toISOString(),
      items: [{ id: 'primary' }],
    })
  })

  test('requires both --from and --to', async () => {
    const missingTo = await freebusy.run({ ...CTX, args: { from: '2026-07-17' } })
    expect(missingTo.ok).toBe(false)
    expect((missingTo as { code?: string }).code).toBe('missing_arg')

    const missingFrom = await freebusy.run({ ...CTX, args: { to: '2026-07-18' } })
    expect(missingFrom.ok).toBe(false)
    expect((missingFrom as { code?: string }).code).toBe('missing_arg')
    expect(queryCalls).toHaveLength(0)
  })

  test('rejects an unparseable bound and an inverted range', async () => {
    const bad = await freebusy.run({ ...CTX, args: { from: 'next tuesday', to: '2026-07-18' } })
    expect(bad.ok).toBe(false)
    expect((bad as { code?: string }).code).toBe('bad_arg')

    const inverted = await freebusy.run({ ...CTX, args: { from: '2026-07-18', to: '2026-07-17' } })
    expect(inverted.ok).toBe(false)
    expect((inverted as { message?: string }).message).toContain('--to must be after --from')
    expect(queryCalls).toHaveLength(0)
  })

  test('rejects a range longer than 90 days with a clear error', async () => {
    const res = await freebusy.run({ ...CTX, args: { from: '2026-01-01', to: '2026-06-01' } })
    expect(res.ok).toBe(false)
    const fail = res as { kind?: string; code?: string; message?: string }
    expect(fail.kind).toBe('user')
    expect(fail.code).toBe('bad_arg')
    expect(fail.message).toContain('90 days')
    expect(queryCalls).toHaveLength(0)
  })

  test('accepts a range of exactly 90 days', async () => {
    const res = await freebusy.run({
      ...CTX,
      args: { from: '2026-01-01T00:00:00Z', to: '2026-04-01T00:00:00Z' },
    })
    expect(res.ok).toBe(true)
    expect(queryCalls).toHaveLength(1)
  })

  test('accepts 90 calendar days that span an extra fall-back DST hour', async () => {
    // 90*24h + 1h — what a 90-calendar-day bare-date range measures when its
    // local midnights straddle a fall-back transition.
    const res = await freebusy.run({
      ...CTX,
      args: { from: '2026-01-01T00:00:00Z', to: '2026-04-01T01:00:00Z' },
    })
    expect(res.ok).toBe(true)
    expect(queryCalls).toHaveLength(1)
  })

  test('normalizes busy intervals and passes per-calendar errors through as data', async () => {
    queryResponse = {
      timeMin: '2026-07-17T09:00:00.000Z',
      timeMax: '2026-07-17T17:00:00.000Z',
      calendars: {
        primary: {
          busy: [
            { start: '2026-07-17T13:00:00Z', end: '2026-07-17T13:30:00Z' },
            { start: '2026-07-17T15:00:00Z', end: '2026-07-17T16:00:00Z' },
          ],
        },
        'nope@example.com': { errors: [{ domain: 'global', reason: 'notFound' }] },
      },
    }
    const res = await freebusy.run({
      ...CTX,
      args: { from: '2026-07-17T09:00:00Z', to: '2026-07-17T17:00:00Z', calendars: 'primary,nope@example.com' },
    })
    expect(res.ok).toBe(true)
    expect((res as { data: unknown }).data).toEqual({
      from: '2026-07-17T09:00:00.000Z',
      to: '2026-07-17T17:00:00.000Z',
      calendars: [
        {
          calendarId: 'primary',
          busy: [
            { start: '2026-07-17T13:00:00Z', end: '2026-07-17T13:30:00Z' },
            { start: '2026-07-17T15:00:00Z', end: '2026-07-17T16:00:00Z' },
          ],
          errors: [],
        },
        {
          calendarId: 'nope@example.com',
          busy: [],
          errors: [{ domain: 'global', reason: 'notFound' }],
        },
      ],
    })
  })
})
