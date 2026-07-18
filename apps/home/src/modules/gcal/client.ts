import { authedRequestJson, requireGoogleCredentials, type GoogleOAuthCredentials } from '../../core/google-auth'
import { SystemError } from '../../core/errors'
import type { RunResult } from '../../core/types'

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

/** Shared OAuth client + gcal's own refresh token. Throws when either is absent. */
export function readGcalCredentials(): GoogleOAuthCredentials {
  return requireGoogleCredentials(GCAL_MODULE)
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

export function freeBusyUrl(): string {
  return `${GCAL_API_BASE}/freeBusy`
}

export interface FreeBusyRequestBody {
  timeMin: string
  timeMax: string
  items: { id: string }[]
}

/** Build the freeBusy POST body — the query's only inputs are the range and the calendar ids. */
export function freeBusyBody(timeMin: string, timeMax: string, calendarIds: string[]): FreeBusyRequestBody {
  return { timeMin, timeMax, items: calendarIds.map((id) => ({ id })) }
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

export interface FreeBusyInterval {
  start: string
  end: string
}

export interface FreeBusyError {
  domain?: string
  reason?: string
}

export interface FreeBusyCalendar {
  busy?: FreeBusyInterval[]
  /** Per-calendar lookup failures (e.g. reason `notFound`) — the query itself still succeeds. */
  errors?: FreeBusyError[]
}

export interface FreeBusyResponse {
  timeMin?: string
  timeMax?: string
  calendars?: Record<string, FreeBusyCalendar>
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
  /** For all-day events this is the INCLUSIVE last day (YYYY-MM-DD); RFC 3339 instant otherwise. */
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
 * Google reports an all-day event's `end.date` as EXCLUSIVE — a one-day event
 * on 2026-07-17 comes back with end 2026-07-18. Collapse it to the inclusive
 * last day the event actually covers, since `events list` / agenda rows (and
 * the LLM consumers they feed) read `end` as that last day. Computed in UTC so
 * the result never shifts with the host timezone.
 */
function inclusiveAllDayEnd(exclusiveEnd: string): string {
  return new Date(Date.parse(`${exclusiveEnd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
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
    end: event.end?.dateTime ?? (event.end?.date ? inclusiveAllDayEnd(event.end.date) : undefined),
    allDay: event.start?.date !== undefined,
    timeZone: event.start?.timeZone,
    location: event.location,
    organizer: event.organizer?.displayName ?? event.organizer?.email,
    recurringEventId: event.recurringEventId,
    originalStart: event.originalStartTime?.dateTime ?? event.originalStartTime?.date,
  }
}

export interface FreeBusyCalendarSummary {
  calendarId: string
  busy: FreeBusyInterval[]
  errors: FreeBusyError[]
}

/**
 * Flatten the freeBusy calendars map to rows, keeping per-calendar `errors`
 * (e.g. notFound for a bad id) as data so one broken calendar cannot fail
 * the whole query.
 */
export function summarizeFreeBusy(res: FreeBusyResponse): FreeBusyCalendarSummary[] {
  return Object.entries(res.calendars ?? {}).map(([calendarId, cal]) => ({
    calendarId,
    busy: cal.busy ?? [],
    errors: cal.errors ?? [],
  }))
}

// --- API functions -------------------------------------------------------

export function listCalendars(cfg: GoogleOAuthCredentials, opts: CalendarsListOptions = {}): Promise<CalendarsListResponse> {
  return authedRequestJson<CalendarsListResponse>(cfg, calendarsListUrl(opts))
}

export function getCalendarListEntry(cfg: GoogleOAuthCredentials, calendarId: string): Promise<CalendarListEntry> {
  return authedRequestJson<CalendarListEntry>(cfg, calendarListEntryUrl(calendarId))
}

export function listEvents(cfg: GoogleOAuthCredentials, calendarId: string, opts: EventsListOptions = {}): Promise<EventsListResponse> {
  return authedRequestJson<EventsListResponse>(cfg, eventsListUrl(calendarId, opts))
}

export function getEvent(cfg: GoogleOAuthCredentials, calendarId: string, eventId: string): Promise<GcalEvent> {
  return authedRequestJson<GcalEvent>(cfg, eventGetUrl(calendarId, eventId))
}

/** POST in transport only — freeBusy queries availability and mutates nothing. */
export function queryFreeBusy(cfg: GoogleOAuthCredentials, body: FreeBusyRequestBody): Promise<FreeBusyResponse> {
  return authedRequestJson<FreeBusyResponse>(cfg, freeBusyUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// --- Status probe --------------------------------------------------------

/**
 * Readiness check backing `manifest.status()`: one bounded calendar-list
 * request (the primary entry — its id is the account email) against
 * already-resolved credentials. Credential resolution (and its
 * `not_configured` failure) is the caller's job — see `readGcalCredentials`
 * — so this only classifies network-layer failures once creds are known
 * good, mapping every failure mode to a stable code:
 *   - `auth_failed`     — Google rejected the stored grant (revoked/expired)
 *   - `upstream_failed` — the Calendar API itself errored or was unreachable
 */
export async function checkGcalStatus(creds: GoogleOAuthCredentials): Promise<RunResult> {
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
