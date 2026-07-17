import type { ModuleManifest } from '../../core/types'
import { GCAL_MODULE, checkGcalStatus } from './client'
import { agenda } from './commands/agenda'
import { calendarsList } from './commands/calendars'
import { eventsGet, eventsList } from './commands/events'
import { freebusy } from './commands/freebusy'
import { authLogin, authStatus } from './commands/auth'

export const manifest: ModuleManifest = {
  name: GCAL_MODULE,
  description:
    'Read Google Calendar — list calendars, list/get events (recurring expanded to instances), merged agenda briefing, free/busy availability',
  whenToUse:
    'Use when the user asks about their Google Calendar schedule, agenda, or availability. "What\'s on my schedule today/this week?" → `agenda` (e.g. `home gcal agenda --days 2`), a merged chronological briefing across every calendar on the account with all-day events ahead of timed ones. "When am I free?" / "is Thursday afternoon open?" → `freebusy`, busy intervals per calendar over a bounded range. Also: list events in a time window or find one by text (`events list` — recurring events expand to instances, defaults to the primary calendar), list the calendars on the account, or inspect one event in full. This module owns schedule/agenda/availability from Google Calendar; Home Assistant calendars are a different surface — use `home assistant calendars` for those. Read-only — it does not create, modify, or respond to events. Requires one-time setup: `home gcal configure` then `home gcal auth login`.',
  configSchema: [
    {
      key: 'clientId',
      label: 'Google OAuth Client ID',
      kind: 'string',
      required: true,
      help: 'Google Cloud Console → APIs & Services → Credentials → OAuth client ID (type "Desktop app"). Enable the Google Calendar API first. The same client as gmail/gdrive works.',
    },
    {
      key: 'clientSecret',
      label: 'Google OAuth Client Secret',
      kind: 'secret',
      required: true,
      help: 'The "Client secret" shown next to the Desktop-app OAuth client',
    },
    {
      key: 'refreshToken',
      label: 'OAuth refresh token',
      kind: 'secret',
      required: false,
      help: 'Leave blank — populated automatically by `home gcal auth login` (browser consent).',
    },
  ],
  commands: [calendarsList, eventsList, eventsGet, agenda, freebusy, authLogin, authStatus],
  async status(cfg) {
    return checkGcalStatus(cfg)
  },
}

export default manifest
