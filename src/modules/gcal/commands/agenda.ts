import type { CommandSpec } from '../../../core/types'
import { listCalendars, listEvents, readGcalConfig, summarizeEvent, type GcalEvent } from '../client'
import {
  AGENDA_DAYS_CAP,
  CALENDARS_MAX_CAP,
  DAY_MS,
  DEFAULT_AGENDA_DAYS,
  parseCalendarIds,
  parseDays,
  parseMax,
} from './shared'

export const DEFAULT_AGENDA_MAX = 50
export const AGENDA_MAX_CAP = 500

export interface AgendaRow {
  calendarId: string
  calendarSummary?: string
  id: string
  summary?: string
  /** ISO 8601 — a bare date (YYYY-MM-DD) for all-day events, RFC 3339 otherwise. */
  start?: string
  end?: string
  allDay: boolean
  location?: string
}

export interface CalendarEvents {
  calendarId: string
  calendarSummary?: string
  events: GcalEvent[]
}

/**
 * Sort key in epoch ms. All-day starts are bare dates keyed to local midnight
 * — the same expansion `--from`/`--to` use — so they lead their day; timed
 * starts are RFC 3339 and compare by absolute instant, which is what
 * interleaves calendars in different time zones correctly.
 */
export function agendaStartMs(start: string | undefined, allDay: boolean): number {
  if (!start) return Number.POSITIVE_INFINITY
  if (allDay) {
    const [year, month, day] = start.split('-').map(Number)
    return new Date(year!, month! - 1, day!).getTime()
  }
  return Date.parse(start)
}

/** Merge per-calendar event pages into one strictly chronological briefing. */
export function mergeAgenda(perCalendar: CalendarEvents[]): AgendaRow[] {
  const rows: AgendaRow[] = perCalendar.flatMap((cal) =>
    cal.events.map((event) => {
      const e = summarizeEvent(event)
      return {
        calendarId: cal.calendarId,
        calendarSummary: cal.calendarSummary,
        id: e.id,
        summary: e.summary,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: e.location,
      }
    }),
  )
  return rows.sort((a, b) => {
    const diff = agendaStartMs(a.start, a.allDay) - agendaStartMs(b.start, b.allDay)
    if (diff !== 0) return diff
    // Exact-midnight tie: the all-day event leads its day.
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
    return (a.start ?? '').localeCompare(b.start ?? '')
  })
}

export const agenda: CommandSpec = {
  path: ['agenda'],
  effect: 'read',
  description:
    'Merged chronological briefing across calendars: everything happening in the next N days in one list, all-day events ahead of timed ones on the same day. Defaults to every calendar on the account.',
  args: [
    { name: 'days', kind: 'number', description: `Window length in days from now (1-${AGENDA_DAYS_CAP}, default ${DEFAULT_AGENDA_DAYS})` },
    { name: 'calendars', kind: 'string', description: 'Comma-separated calendar ids (default: all calendars on the account)' },
    { name: 'max', kind: 'number', description: `Max merged rows (1-${AGENDA_MAX_CAP}, default ${DEFAULT_AGENDA_MAX}); sets truncated=true when cut` },
  ],
  examples: [
    'home gcal agenda --json',
    'home gcal agenda --days 7 --json',
    "home gcal agenda --days 2 --calendars primary,team@group.calendar.google.com --json | jq '.events[] | {start, summary}'",
  ],
  async run(ctx) {
    const days = parseDays(ctx)
    if (days.error) return { ok: false, kind: 'user', message: days.error, code: 'bad_arg' }
    if (days.warning && ctx.log) ctx.log.warn(days.warning)
    const max = parseMax(ctx, DEFAULT_AGENDA_MAX, AGENDA_MAX_CAP)
    if (max.error) return { ok: false, kind: 'user', message: max.error, code: 'bad_arg' }
    if (max.warning && ctx.log) ctx.log.warn(max.warning)

    const cfg = readGcalConfig(ctx.config)
    const explicitIds = parseCalendarIds(ctx)
    let targets: { id: string; summary?: string }[]
    if (explicitIds) {
      targets = explicitIds.map((id) => ({ id }))
    } else {
      const page = await listCalendars(cfg, { maxResults: CALENDARS_MAX_CAP })
      targets = (page.items ?? [])
        .filter((entry) => entry.deleted !== true)
        .map((entry) => ({ id: entry.id, summary: entry.summaryOverride ?? entry.summary }))
      if (targets.length === 0) targets = [{ id: 'primary' }]
    }

    const now = new Date()
    const timeMin = now.toISOString()
    const timeMax = new Date(now.getTime() + days.value! * DAY_MS).toISOString()

    const pages = await Promise.all(
      targets.map((target) => listEvents(cfg, target.id, { timeMin, timeMax, maxResults: max.value })),
    )
    const merged = mergeAgenda(
      targets.map((target, i) => ({
        calendarId: target.id,
        calendarSummary: target.summary ?? pages[i]?.summary,
        events: pages[i]?.items ?? [],
      })),
    )
    const truncated = merged.length > max.value! || pages.some((page) => page.nextPageToken !== undefined)
    return {
      ok: true,
      data: {
        from: timeMin,
        to: timeMax,
        days: days.value,
        calendars: targets.map((t) => t.id),
        events: merged.slice(0, max.value),
        truncated,
      },
    }
  },
}
