import type { CommandSpec } from '../../../core/types'
import { freeBusyBody, queryFreeBusy, readGcalConfig, summarizeFreeBusy } from '../client'
import { DAY_MS, parseCalendarIds, parseTimeBound } from './shared'

// The freeBusy endpoint itself degrades past ~3 months; reject early with a clear error.
export const FREEBUSY_RANGE_CAP_DAYS = 90

export const freebusy: CommandSpec = {
  path: ['freebusy'],
  effect: 'read',
  description:
    'Query busy intervals per calendar over a time range (max 90 days). Per-calendar lookup failures (e.g. notFound) come back as data in errors[], not as a command failure.',
  args: [
    { name: 'from', kind: 'string', required: true, description: 'Range start — RFC 3339 or YYYY-MM-DD (local midnight)' },
    { name: 'to', kind: 'string', required: true, description: 'Range end — RFC 3339 or YYYY-MM-DD (local midnight)' },
    { name: 'calendars', kind: 'string', description: 'Comma-separated calendar ids (default primary)' },
  ],
  examples: [
    'home gcal freebusy --from 2026-07-17 --to 2026-07-18 --json',
    "home gcal freebusy --from 2026-07-17T09:00:00Z --to 2026-07-17T17:00:00Z --calendars primary,team@group.calendar.google.com --json | jq '.calendars[]'",
  ],
  async run(ctx) {
    const from = parseTimeBound(ctx, 'from')
    if (from.error) return { ok: false, kind: 'user', message: from.error, code: 'bad_arg' }
    const to = parseTimeBound(ctx, 'to')
    if (to.error) return { ok: false, kind: 'user', message: to.error, code: 'bad_arg' }
    if (!from.value || !to.value) {
      return { ok: false, kind: 'user', message: '--from and --to are required', code: 'missing_arg' }
    }
    const rangeMs = Date.parse(to.value) - Date.parse(from.value)
    if (rangeMs <= 0) {
      return { ok: false, kind: 'user', message: '--to must be after --from', code: 'bad_arg' }
    }
    if (rangeMs > FREEBUSY_RANGE_CAP_DAYS * DAY_MS) {
      return {
        ok: false,
        kind: 'user',
        message: `time range too large — freebusy is capped at ${FREEBUSY_RANGE_CAP_DAYS} days; narrow --from/--to`,
        code: 'bad_arg',
      }
    }

    const calendarIds = parseCalendarIds(ctx) ?? ['primary']
    const cfg = readGcalConfig(ctx.config)
    const res = await queryFreeBusy(cfg, freeBusyBody(from.value, to.value, calendarIds))
    return {
      ok: true,
      data: {
        from: res.timeMin ?? from.value,
        to: res.timeMax ?? to.value,
        calendars: summarizeFreeBusy(res),
      },
    }
  },
}
