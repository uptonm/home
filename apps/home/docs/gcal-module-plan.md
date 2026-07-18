# Google Calendar Module Plan (greenfield)

Plan for a **new `gcal` module** — Google Calendar API
(`www.googleapis.com/calendar/v3`) — read-only, single account, with the same
`list`/`get`-first shape as gmail/gdrive. Reuses `core/google-auth` verbatim;
only the scope list and API base differ.

> Decisions locked (2026-07-17 brainstorm): **read-only across the whole Google
> surface** this round (no gmail Phase 2 send/modify either), **single
> account** (matching gmail/gdrive), module named **`gcal`** — plain `calendar`
> would collide conceptually with the `assistant` module's Home Assistant
> calendars.

---

## New-module scaffold (Phase 0)

- `src/modules/gcal/{index,client,configure}.ts` (mirrors `src/modules/gmail`).
- Config schema identical to gmail: `clientId` (string), `clientSecret`
  (secret), `refreshToken` (secret, `required: false` — populated by
  `home gcal auth login`).
- Reuse the **same Google Cloud OAuth client** as gmail/gdrive; just enable the
  Calendar API on the project. The module mints its own refresh token scoped to
  calendar only.
- Register manifest in `src/registry.ts`; `home skill install`.
- `status()` → `GET /users/me/calendarList?maxResults=1` (cheap auth probe).

**Auth scope:** `https://www.googleapis.com/auth/calendar.readonly` (covers
calendarList, events, freeBusy).

---

## Phase 1 — Read spine

| # | Command | Endpoint | Kind |
|---|---|---|---|
| 1 | `auth login` / `auth status` | loopback OAuth (copy of gmail `commands/auth.ts`, calendar scope) | auth |
| 2 | `calendars list` | `GET /users/me/calendarList` | list (includes shared/subscribed calendars) |
| 3 | `events list [calendarId] [--from <t>] [--to <t>] [--max <n>] [--q <text>]` | `GET /calendars/{id}/events?singleEvents=true&orderBy=startTime` | list (recurring events expanded to instances) |
| 4 | `events get <calendarId> <eventId>` | `GET /calendars/{id}/events/{eventId}` | get |
| 5 | `agenda [--days <n>] [--max <n>] [--calendars <id,…>]` | fan-out `events list` across the calendar list, merge chronologically | composite |
| 6 | `freebusy --from <t> --to <t> [--calendars <id,…>]` | `POST /freeBusy` | query (read-only POST) |

Notes:

- `calendarId` defaults to `primary` on `events list`.
- `--from`/`--to` accept RFC 3339 or bare `YYYY-MM-DD` (expanded to local
  midnight); map to `timeMin`/`timeMax`.
- `agenda` is the briefing workhorse: defaults to the next 7 days across all
  calendars, all-day events normalized ahead of timed ones on the same day.
  Merge logic lives in a pure function for testing.
- Events return full payloads (unlike gmail messages) — no `--hydrate` needed.
- URL builders stay pure (no network) per repo convention; a `commands/shared.ts`
  holds `parseTimeRange`/`parseCalendarIds`-style helpers.

### Phase 1 PR breakdown (stackable)

1. PR: scaffold + `calendars list` + `events list/get`.
2. PR: `agenda` + `freebusy` (+ skill polish: `whenToUse`, examples like
   `home gcal agenda --days 2`).

---

## Explicitly out of scope (YAGNI)

- **All writes**: event insert/patch/delete, invite responses (would need
  `calendar.events` scope).
- Colors, ACLs, settings endpoints, push notification channels (`watch`).
- Multi-account support.
- Syncing calendar data into the atlas Postgres DB — belongs to the separate
  ingestion-pipeline plan, not this module.

---

## Testing

- `src/__tests__/gcal-client.test.ts` — URL builders, config reader, time-range
  parsing.
- `src/__tests__/gcal-agenda.test.ts` — merge ordering, all-day vs timed
  normalization, `--calendars` filtering.
