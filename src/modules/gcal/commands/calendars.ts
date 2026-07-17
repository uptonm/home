import type { CommandSpec } from '../../../core/types'
import { listCalendars, readGcalCredentials, summarizeCalendar } from '../client'
import { CALENDARS_MAX_CAP, DEFAULT_CALENDARS_MAX, optionalString, parseMax } from './shared'

export const calendarsList: CommandSpec = {
  path: ['calendars', 'list'],
  effect: 'read',
  description:
    'List calendars on the account — owned, shared, and subscribed — with id, summary, primary flag, access role, and time zone.',
  args: [
    { name: 'max', kind: 'number', description: `Max results per page (1-${CALENDARS_MAX_CAP}, default ${DEFAULT_CALENDARS_MAX})` },
    { name: 'page-token', kind: 'string', description: 'nextPageToken from a previous page' },
  ],
  examples: [
    'home gcal calendars list --json',
    "home gcal calendars list --json | jq '.calendars[] | {id, summary, accessRole}'",
  ],
  async run(ctx) {
    const max = parseMax(ctx, DEFAULT_CALENDARS_MAX, CALENDARS_MAX_CAP)
    if (max.error) return { ok: false, kind: 'user', message: max.error, code: 'bad_arg' }
    if (max.warning && ctx.log) ctx.log.warn(max.warning)

    const creds = readGcalCredentials()
    const page = await listCalendars(creds, {
      maxResults: max.value,
      pageToken: optionalString(ctx, 'page-token'),
    })
    return {
      ok: true,
      data: {
        calendars: (page.items ?? []).map(summarizeCalendar),
        nextPageToken: page.nextPageToken,
      },
    }
  },
}
