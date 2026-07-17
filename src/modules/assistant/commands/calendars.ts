import type { CommandSpec } from '../../../core/types'
import { getCalendar, listCalendars, readAssistantConfig } from '../client'

const DAY_MS = 86_400_000

/**
 * Parse a single window endpoint into epoch millis. Accepts an ISO timestamp,
 * or a relative duration (`7d`, `12h`, `-1d`) interpreted as an offset from
 * `nowMs` (positive = future). Returns null when unparseable/empty.
 */
export function parseCalendarPoint(value: string | undefined, nowMs: number): number | null {
  if (!value) return null
  const m = /^([+-]?)(\d+)(s|m|h|d)$/.exec(value.trim())
  if (m) {
    const sign = m[1] === '-' ? -1 : 1
    const n = Number(m[2])
    const unit = m[3]!
    const ms = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : DAY_MS
    return nowMs + sign * n * ms
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Resolve a [start, end] window into ISO strings. Defaults: start = now,
 * end = start + 7 days. Pure so the date math can be unit-tested.
 */
export function resolveCalendarWindow(
  startArg: string | undefined,
  endArg: string | undefined,
  nowMs: number,
): { start: string; end: string } {
  const startMs = parseCalendarPoint(startArg, nowMs) ?? nowMs
  const endMs = parseCalendarPoint(endArg, nowMs) ?? startMs + 7 * DAY_MS
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() }
}

export const calendarsList: CommandSpec = {
  path: ['calendars', 'list'],
  effect: 'read',
  description: 'List calendar entities',
  args: [],
  examples: [
    'home assistant calendars list --json',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const data = await listCalendars(cfg)
    return { ok: true, data }
  },
}

export const calendarsGet: CommandSpec = {
  path: ['calendars', 'get'],
  effect: 'read',
  description: 'Get events for a calendar within a [start, end] window',
  args: [
    { name: 'entity', kind: 'positional', description: 'Calendar entity_id (e.g. calendar.personal)', required: true },
    { name: 'start', kind: 'string', description: 'Window start: ISO | 7d | -1d (default now)' },
    { name: 'end', kind: 'string', description: 'Window end: ISO | 7d (default start + 7d)' },
  ],
  examples: [
    'home assistant calendars get calendar.personal --json',
    'home assistant calendars get calendar.holidays --start 2026-06-01 --end 30d --json',
  ],
  async run(ctx) {
    const cfg = readAssistantConfig(ctx.config)
    const entity = String(ctx.args.entity ?? '')
    if (!entity) return { ok: false, kind: 'user', message: 'entity is required', code: 'missing_arg' }
    const { start, end } = resolveCalendarWindow(
      ctx.args.start as string | undefined,
      ctx.args.end as string | undefined,
      Date.now(),
    )
    const data = await getCalendar(cfg, entity, start, end)
    return { ok: true, data }
  },
}
