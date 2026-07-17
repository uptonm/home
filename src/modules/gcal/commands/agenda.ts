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
 * Sort key in epoch ms for timed events — their absolute instant, which is
 * what interleaves calendars in different time zones correctly within a day.
 */
export function agendaStartMs(start: string | undefined): number {
  return start ? Date.parse(start) : Number.POSITIVE_INFINITY
}

/**
 * The calendar day a row belongs to. All-day starts are already `YYYY-MM-DD`;
 * a timed start carries its own local date in the first 10 chars, so an event
 * on a calendar ahead of the host still groups under its own day instead of
 * leaking into the host-timezone day of its absolute instant.
 */
export function agendaDayKey(start: string | undefined): string {
  return start ? start.slice(0, 10) : '9999-99-99'
}

/** Merge per-calendar event pages into one chronological briefing. */
export function mergeAgenda(perCalendar: CalendarEvents[]): AgendaRow[] {
  const seen = new Set<string>()
  const rows: AgendaRow[] = []
  for (const cal of perCalendar) {
    for (const event of cal.events) {
      const e = summarizeEvent(event)
      // The same underlying event surfaces on several subscribed calendars (an
      // invitee copy on primary plus the shared-calendar copy); keep the first
      // calendar's row so duplicates don't inflate the count toward `--max`.
      const key = e.id || `${e.recurringEventId ?? ''}::${e.start ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        calendarId: cal.calendarId,
        calendarSummary: cal.calendarSummary,
        id: e.id,
        summary: e.summary,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: e.location,
      })
    }
  }
  return rows.sort((a, b) => {
    const dayA = agendaDayKey(a.start)
    const dayB = agendaDayKey(b.start)
    if (dayA !== dayB) return dayA < dayB ? -1 : 1
    // Within a day, all-day events lead, then timed events by absolute instant.
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
    const diff = agendaStartMs(a.start) - agendaStartMs(b.start)
    if (diff !== 0) return diff
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
