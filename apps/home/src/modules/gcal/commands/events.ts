import type { CommandSpec } from '../../../core/types'
import { getEvent, listEvents, readGcalCredentials, summarizeEvent } from '../client'
import { DEFAULT_EVENTS_MAX, EVENTS_MAX_CAP, optionalString, parseMax, parseTimeBound } from './shared'

export const eventsList: CommandSpec = {
  path: ['events', 'list'],
  effect: 'read',
  description:
    'List events on a calendar ordered by start time, with recurring events expanded to individual instances. Calendar defaults to `primary`.',
  args: [
    { name: 'calendarId', kind: 'positional', description: 'Calendar id from `calendars list` (default primary)', required: false },
    { name: 'from', kind: 'string', description: 'Lower time bound (events ending after) — RFC 3339 or YYYY-MM-DD (local midnight)' },
    { name: 'to', kind: 'string', description: 'Upper time bound (events starting before) — RFC 3339, or YYYY-MM-DD to include the whole named day' },
    { name: 'q', kind: 'string', description: 'Free-text search over summary/description/location/attendees' },
    { name: 'max', kind: 'number', description: `Max results per page (1-${EVENTS_MAX_CAP}, default ${DEFAULT_EVENTS_MAX})` },
    { name: 'page-token', kind: 'string', description: 'nextPageToken from a previous page' },
  ],
  examples: [
    'home gcal events list --from 2026-07-17 --to 2026-07-24 --json',
    'home gcal events list team@group.calendar.google.com --q standup --json',
    "home gcal events list --from 2026-07-17T09:00:00Z --max 10 --json | jq '.events[] | {summary, start}'",
  ],
  async run(ctx) {
    const max = parseMax(ctx, DEFAULT_EVENTS_MAX, EVENTS_MAX_CAP)
    if (max.error) return { ok: false, kind: 'user', message: max.error, code: 'bad_arg' }
    if (max.warning && ctx.log) ctx.log.warn(max.warning)

    const from = parseTimeBound(ctx, 'from')
    if (from.error) return { ok: false, kind: 'user', message: from.error, code: 'bad_arg' }
    const to = parseTimeBound(ctx, 'to', true)
    if (to.error) return { ok: false, kind: 'user', message: to.error, code: 'bad_arg' }

    const calendarId = optionalString(ctx, 'calendarId') ?? 'primary'
    const creds = readGcalCredentials()
    const page = await listEvents(creds, calendarId, {
      timeMin: from.value,
      timeMax: to.value,
      q: optionalString(ctx, 'q'),
      maxResults: max.value,
      pageToken: optionalString(ctx, 'page-token'),
    })
    return {
      ok: true,
      data: {
        calendarId,
        calendarSummary: page.summary,
        timeZone: page.timeZone,
        events: (page.items ?? []).map(summarizeEvent),
        nextPageToken: page.nextPageToken,
      },
    }
  },
}

export const eventsGet: CommandSpec = {
  path: ['events', 'get'],
  effect: 'read',
  description: 'Get a single event by calendar id and event id (full payload).',
  args: [
    { name: 'calendarId', kind: 'positional', description: 'Calendar id from `calendars list` (or `primary`)', required: true },
    { name: 'eventId', kind: 'positional', description: 'Event id from `events list`', required: true },
  ],
  examples: [
    'home gcal events get primary 5ka1bc2def3ghi4jkl5mno6p --json',
    'home gcal events get team@group.calendar.google.com 5ka1bc2def3ghi4jkl5mno6p --json',
  ],
  async run(ctx) {
    const calendarId = String(ctx.args.calendarId ?? '').trim()
    if (!calendarId) return { ok: false, kind: 'user', message: 'calendarId is required', code: 'missing_arg' }
    const eventId = String(ctx.args.eventId ?? '').trim()
    if (!eventId) return { ok: false, kind: 'user', message: 'eventId is required', code: 'missing_arg' }

    const creds = readGcalCredentials()
    const data = await getEvent(creds, calendarId, eventId)
    return { ok: true, data }
  },
}
