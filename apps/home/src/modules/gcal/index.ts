import type { ModuleManifest } from '../../core/types'
import { NotConfiguredError } from '../../core/errors'
import { GCAL_MODULE, checkGcalStatus, readGcalCredentials } from './client'
import { configureGcal } from './configure'
import { agenda } from './commands/agenda'
import { calendarsList } from './commands/calendars'
import { eventsGet, eventsList } from './commands/events'
import { freebusy } from './commands/freebusy'

export const manifest: ModuleManifest = {
  name: GCAL_MODULE,
  description:
    'Read Google Calendar — list calendars, list/get events (recurring expanded to instances), merged agenda briefing, free/busy availability',
  whenToUse:
    'Use when the user asks about their Google Calendar schedule, agenda, or availability. "What\'s on my schedule today/this week?" → `agenda` (e.g. `home gcal agenda --days 2`), a merged chronological briefing across every calendar on the account with all-day events ahead of timed ones. "When am I free?" / "is Thursday afternoon open?" → `freebusy`, busy intervals per calendar over a bounded range. Also: list events in a time window or find one by text (`events list` — recurring events expand to instances, defaults to the primary calendar), list the calendars on the account, or inspect one event in full. This module owns schedule/agenda/availability from Google Calendar; Home Assistant calendars are a different surface — use `home assistant calendars` for those. Read-only — it does not create, modify, or respond to events. Requires a one-time `home google configure` (shared OAuth client, see docs/google-setup.md) then `home gcal configure` (browser consent) — both interactive; you cannot drive them, so ask the user to run them.',
  configSchema: [
    {
      // Written by `home gcal configure`, not typed — declared here (like
      // gmail's) so `secrets export` and vercel sync can see it. An undeclared
      // secret is invisible to every schema-driven inventory.
      key: 'refreshToken',
      label: 'OAuth refresh token',
      kind: 'secret',
      required: false,
      help: 'Written by `home gcal configure` (browser consent) — not typed by hand.',
    },
  ],
  requiresConfig: false,
  configure: configureGcal,
  commands: [calendarsList, eventsList, eventsGet, agenda, freebusy],
  async status() {
    try {
      const creds = readGcalCredentials()
      return checkGcalStatus(creds)
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        return { ok: false, kind: 'config', code: 'not_configured', message: err.message }
      }
      throw err
    }
  },
}

export default manifest
