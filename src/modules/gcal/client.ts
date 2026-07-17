import { authedRequestJson, type GoogleOAuthCredentials } from '../../core/google-auth'
import { SystemError } from '../../core/errors'
import type { ModuleConfig, RunResult } from '../../core/types'

/**
 * Google Calendar REST client (read-only). Calendar-list requests hit
 * `users/me`; event requests hit `calendars/{calendarId}`. Every request
 * carries a bearer token minted by `core/google-auth` from the stored refresh
 * token. URL builders and normalizers are kept pure and exported so they can
 * be unit-tested without a network or real credentials.
 */

/** Module name — also the namespace under which secrets are stored. */
export const GCAL_MODULE = 'gcal'

export const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3'

/** Read-spine scope: covers calendarList, events, and freeBusy. */
export const GCAL_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
export const GCAL_SCOPES = [GCAL_READONLY_SCOPE]

/** Secret key under which the OAuth refresh token is persisted (module "gcal"). */
export const GCAL_REFRESH_TOKEN_KEY = 'refreshToken'

export type GcalConfig = GoogleOAuthCredentials

export function readGcalConfig(cfg: ModuleConfig): GcalConfig {
  return {
    clientId: String(cfg.clientId ?? ''),
    clientSecret: String(cfg.clientSecret ?? ''),
    refreshToken: String(cfg.refreshToken ?? ''),
  }
}

// --- URL builders (pure) -------------------------------------------------

function withQuery(base: string, params: URLSearchParams): string {
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

export interface CalendarsListOptions {
  maxResults?: number
  pageToken?: string
}

export function calendarsListUrl(opts: CalendarsListOptions = {}): string {
  const p = new URLSearchParams()
  if (opts.maxResults !== undefined) p.set('maxResults', String(opts.maxResults))
  if (opts.pageToken) p.set('pageToken', opts.pageToken)
  return withQuery(`${GCAL_API_BASE}/users/me/calendarList`, p)
}

export function calendarListEntryUrl(calendarId: string): string {
  return `${GCAL_API_BASE}/users/me/calendarList/${encodeURIComponent(calendarId)}`
}

export interface EventsListOptions {
  /** RFC 3339 lower bound — instances that end after this time. */
  timeMin?: string
  /** RFC 3339 upper bound — instances that start before this time. */
  timeMax?: string
  /** Free-text search over summary/description/location/attendees. */
  q?: string
  maxResults?: number
  pageToken?: string
}

/**
 * `singleEvents=true` expands recurring events into individual instances,
 * which is also what makes `orderBy=startTime` legal — the API rejects
 * start-time ordering over unexpanded recurrences.
 */
export function eventsListUrl(calendarId: string, opts: EventsListOptions = {}): string {
  const p = new URLSearchParams()
  p.set('singleEvents', 'true')
  p.set('orderBy', 'startTime')
  if (opts.timeMin) p.set('timeMin', opts.timeMin)
  if (opts.timeMax) p.set('timeMax', opts.timeMax)
  if (opts.q) p.set('q', opts.q)
  if (opts.maxResults !== undefined) p.set('maxResults', String(opts.maxResults))
  if (opts.pageToken) p.set('pageToken', opts.pageToken)
  return withQuery(`${GCAL_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, p)
}

export function eventGetUrl(calendarId: string, eventId: string): string {
  return `${GCAL_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
}

// --- Response shapes -----------------------------------------------------

export interface CalendarListEntry {
  id: string
  summary?: string
  /** The user's private rename of a shared/subscribed calendar. */
  summaryOverride?: string
  description?: string
  timeZone?: string
  accessRole?: string
  primary?: boolean
  selected?: boolean
  hidden?: boolean
  deleted?: boolean
}

export interface CalendarsListResponse {
  items?: CalendarListEntry[]
  nextPageToken?: string
}

/** All-day events carry `date` (YYYY-MM-DD); timed events carry `dateTime` (RFC 3339). */
export interface EventDateTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface EventPerson {
  email?: string
  displayName?: string
  self?: boolean
  responseStatus?: string
  organizer?: boolean
}

export interface GcalEvent {
  id: string
  status?: string
  htmlLink?: string
  summary?: string
  description?: string
  location?: string
  creator?: EventPerson
  organizer?: EventPerson
  start?: EventDateTime
  end?: EventDateTime
  /** Present on expanded instances: the id of the parent recurring event. */
  recurringEventId?: string
  /** Present on expanded instances: the slot this instance originally occupied. */
  originalStartTime?: EventDateTime
  attendees?: EventPerson[]
  created?: string
  updated?: string
}

export interface EventsListResponse {
  /** Title of the calendar the events came from. */
  summary?: string
  timeZone?: string
  items?: GcalEvent[]
  nextPageToken?: string
}

// --- Normalizers (pure) --------------------------------------------------

export interface CalendarSummary {
  id: string
  summary?: string
  primary: boolean
  accessRole?: string
  timeZone?: string
  description?: string
}

/** Flatten a calendarList entry to the row `calendars list` prints. */
export function summarizeCalendar(entry: CalendarListEntry): CalendarSummary {
  return {
    id: entry.id,
    summary: entry.summaryOverride ?? entry.summary,
    primary: entry.primary === true,
    accessRole: entry.accessRole,
    timeZone: entry.timeZone,
    description: entry.description,
  }
}

export interface EventSummary {
  id: string
  summary?: string
  status?: string
  /** ISO 8601 — a bare date (YYYY-MM-DD) for all-day events, RFC 3339 otherwise. */
  start?: string
  end?: string
  allDay: boolean
  timeZone?: string
  location?: string
  organizer?: string
  /** Set on recurring-event instances (singleEvents expansion). */
  recurringEventId?: string
  originalStart?: string
}

/**
 * Flatten an event into the compact row `events list` prints: start/end
 * collapsed to a single ISO 8601 string each (all-day `date` vs timed
 * `dateTime`), plus the recurring-instance provenance fields.
 */
export function summarizeEvent(event: GcalEvent): EventSummary {
  return {
    id: event.id,
    summary: event.summary,
    status: event.status,
    start: event.start?.dateTime ?? event.start?.date,
    end: event.end?.dateTime ?? event.end?.date,
    allDay: event.start?.date !== undefined,
    timeZone: event.start?.timeZone,
    location: event.location,
    organizer: event.organizer?.displayName ?? event.organizer?.email,
    recurringEventId: event.recurringEventId,
    originalStart: event.originalStartTime?.dateTime ?? event.originalStartTime?.date,
  }
}

// --- API functions -------------------------------------------------------

export function listCalendars(cfg: GcalConfig, opts: CalendarsListOptions = {}): Promise<CalendarsListResponse> {
  return authedRequestJson<CalendarsListResponse>(cfg, calendarsListUrl(opts))
}

export function getCalendarListEntry(cfg: GcalConfig, calendarId: string): Promise<CalendarListEntry> {
  return authedRequestJson<CalendarListEntry>(cfg, calendarListEntryUrl(calendarId))
}

export function listEvents(cfg: GcalConfig, calendarId: string, opts: EventsListOptions = {}): Promise<EventsListResponse> {
  return authedRequestJson<EventsListResponse>(cfg, eventsListUrl(calendarId, opts))
}

export function getEvent(cfg: GcalConfig, calendarId: string, eventId: string): Promise<GcalEvent> {
  return authedRequestJson<GcalEvent>(cfg, eventGetUrl(calendarId, eventId))
}

// --- Status probe --------------------------------------------------------

/**
 * Readiness check shared by `manifest.status()` and `gcal auth status`: one
 * bounded calendar-list request (the primary entry — its id is the account
 * email). Never throws; every failure mode maps to a stable code:
 *   - `not_configured`  — clientId/clientSecret absent
 *   - `unauthorized`    — no refresh token yet (`auth login` not run)
 *   - `auth_failed`     — Google rejected the stored grant (revoked/expired)
 *   - `upstream_failed` — the Calendar API itself errored or was unreachable
 */
export async function checkGcalStatus(cfg: ModuleConfig): Promise<RunResult> {
  const creds = readGcalConfig(cfg)
  if (!creds.clientId || !creds.clientSecret) {
    return {
      ok: false,
      kind: 'config',
      message: 'gcal clientId/clientSecret not set — run `home gcal configure` first',
      code: 'not_configured',
    }
  }
  if (!creds.refreshToken) {
    return {
      ok: false,
      kind: 'config',
      message: 'gcal is configured but not authorized — run `home gcal auth login`',
      code: 'unauthorized',
    }
  }
  try {
    const primary = await getCalendarListEntry(creds, 'primary')
    return {
      ok: true,
      data: {
        status: 'authenticated',
        account: primary.id,
        timeZone: primary.timeZone ?? null,
      },
    }
  } catch (err) {
    return classifyStatusError(err)
  }
}

function classifyStatusError(err: unknown): RunResult {
  const message = err instanceof Error ? err.message : String(err)
  const code = err instanceof SystemError ? err.code : undefined
  if (code === 'google_unconfigured') return { ok: false, kind: 'config', message, code: 'not_configured' }
  if (code === 'google_unauthorized') return { ok: false, kind: 'config', message, code: 'unauthorized' }
  if (code === 'google_refresh_rejected' || code === 'http_401') {
    return { ok: false, kind: 'system', message, code: 'auth_failed' }
  }
  return { ok: false, kind: 'system', message, code: 'upstream_failed' }
}
