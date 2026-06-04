# UniFi Protect API Gap-Closure Plan

Action plan to give every UniFi Protect entity a `list` (and where it makes
sense `get`) command, then layer the official **Protect Integration API** in
behind the existing SDK as a fallback (dual-support entities) and as an
extension (integration-only realtime/streaming).

Mirrors the structure of `unifi-api-gap-plan.md`. Strategy, in order:

1. **Phase 1 — close every gap on the current SDK / private API**
   (`unifi-protect` SDK over `/proxy/protect/api/...`), the surface the module
   already speaks. Richest data (full bootstrap), fastest to ship.
2. **Phase 2 — add the official Protect Integration API**
   (`/proxy/protect/integration/v1/...`, Protect 6.x, `X-API-KEY`):
   - as a **fallback** for dual-support entities (cameras, lights, sensors,
     chimes, viewers, liveviews, nvr),
   - as an **extension** for integration-only capabilities (realtime
     `subscribe` WebSockets, RTSPS stream provisioning).

Phase 1 stays read/inspect oriented (control commands already exist); Phase 2
adds the supported transport + net-new realtime/streaming.

---

## How Protect differs from the Network module

- **Transport:** Network uses raw `requestJson` against REST paths. Protect goes
  through the **`unifi-protect` SDK** (hjdhjd, v4.29): `connect()` logs in and
  pulls a single **`bootstrap`** object. "list" = read `api.bootstrap?.<key>`,
  "get" = `.find(x => x.id === ref)`. Events are the lone exception, hitting
  `/proxy/protect/api/events` via `api.retrieve()`.
- **Auth:** Protect auths with **username/password** (a controller-local user).
  The official Integration API instead uses **`X-API-KEY`** — so Phase 2
  requires adding an `apiKey` config field (Phase 1 needs no config change).
- **Bootstrap modelKeys** (the full entity surface): `nvr`, `camera`, `light`,
  `sensor`, `chime`, `viewer`, `bridge`, `doorlock`, `liveview`, `ringtone`,
  `user`, `group`.

---

## 0. Baseline — what exists today

| Entity | list | get | control/action |
|---|---|---|---|
| cameras | ✅ | ✅ (id only) | ptz, led, talkback, snapshot |
| lights | ❌ | ❌ | ✅ on/off/toggle + brightness |
| events | ✅ (+`recent`) | ❌ | — |
| nvr, sensors, chimes, viewers, bridges, doorlocks, liveviews, ringtones, users, groups | ❌ | ❌ | — |

Two pre-existing issues to fix as part of this work:

1. **`cameras get` resolves by id only**, while ptz/led/talkback/snapshot all
   accept **name or id**. Inconsistent — `snapshot "Front Door"` works but
   `cameras get "Front Door"` fails.
2. **No shared resolver** — every command re-inlines
   `coll.find(id) ?? coll.find(name)`. Adding ~10 list/get entities multiplies
   this. Extract one helper first.

---

## Phase 1 — Close all gaps on the SDK / private API

### Step 1.0 — shared resolver (prereq, one small PR)

Add `src/modules/protect/resolve.ts`:

```ts
// pure + unit-testable, mirrors the network module's resolveDevice/matchNetwork
resolve<T extends { id?: string; name?: string }>(coll: T[], ref: string):
  | { kind: 'ok'; item: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; matches: T[] }
// order: exact id → exact name (case-insensitive) → unique name substring
```

Refactor `cameras get`, ptz, led, talkback, snapshot, lights to use it →
`cameras get` now accepts name, and all entity commands share one resolver.

### Step 1.1 — list/get for every bootstrap entity

Each is the **exact `cameras.ts` shape** (read collection / resolve by ref), so
they are cheap and uniform. New file `commands/<entity>.ts` per entity +
`__tests__/protect-<entity>.test.ts` (shape, resolver, not_found, spec wiring),
registered in `index.ts`.

| # | Command | bootstrap key | Priority / why |
|---|---|---|---|
| 1 | `sensors list/get` | `sensors` | **highest** — UP-Sense door/window/motion/leak + temp/humidity/light readings; currently zero visibility |
| 2 | `lights list/get` | `lights` | finish the control-only entity (you control but can't enumerate) |
| 3 | `nvr info` | `nvr` (singleton) | controller info: version, storage, recording, uptime — mirrors `unifi controller info` |
| 4 | `doorlocks list/get` | `doorlocks` | UA smart locks (lock state, battery) |
| 5 | `chimes list/get` | `chimes` | doorbell chimes |
| 6 | `viewers list/get` | `viewers` | Protect Viewport display devices |
| 7 | `bridges list/get` | `bridges` | UP connect bridges |
| 8 | `liveviews list/get` | `liveviews` | saved multi-camera layouts |
| 9 | `ringtones list` | `ringtones` | chime ringtone library |
| 10 | `users list/get` | `users` | Protect users/permissions |
| 11 | `events get <id>` | `/proxy/protect/api/events/{id}` | you `list` but can't fetch one by id |

### Phase 1 PR breakdown (stackable)

1. PR: shared `resolve()` helper + refactor existing commands (fixes `cameras get` name bug).
2. PR: `sensors` + `lights` list/get (the two highest-value).
3. PR: `nvr info` + `events get`.
4. PR: remaining entities (doorlocks, chimes, viewers, bridges, liveviews, ringtones, users).

---

## Phase 2 — Official Protect Integration API: fallback + extension

The Integration API (`/proxy/protect/integration/v1`, Protect **6.x+**,
`X-API-KEY`) is officially supported and versioned. It covers **cameras, lights,
sensors, chimes, viewers, liveviews, nvr** (list/get, PATCH for writes as they
roll out, snapshot, RTSPS stream) and adds **realtime `subscribe` WebSockets**.
It does **not** cover bridges, doorlocks, ringtones, users, or groups — those
stay SDK-only.

### 2A. Shared infrastructure (one PR)

New file `src/modules/protect/integration-client.ts`:

```
base   = `${cfg.url}/proxy/protect/integration/v1`
header = { 'X-API-KEY': cfg.apiKey, Accept: 'application/json' }
```

- `appInfo(cfg)` → `GET /meta/info` (version + capability probe).
- Thin `getJson(path)` reusing `requestJson` + `insecureTLS` (no SDK login, no
  bootstrap, no login-throttle pacing — stateless key auth).
- Config (`index.ts`): add optional `apiKey` (`kind: 'secret'`) +
  `source: auto|sdk|integration` (default `auto`: prefer SDK, fall back to
  integration). Keep `username`/`password` for the SDK path.

### 2B. Dual-support fallback (cameras, lights, sensors, chimes, viewers, liveviews, nvr)

Normalizer maps integration response fields → the bootstrap-shaped rows the
Phase 1 commands already emit, then route list/get through:

```
async function withSource(cfg, sdkFn, integrationFn) {
  if (cfg.source === 'integration') return integrationFn()
  try { return await sdkFn() }
  catch (e) {
    if (cfg.source === 'sdk') throw e
    if (isAuthOrUnavailable(e)) return integrationFn()   // login throttle / 401 / unavailable
    throw e
  }
}
```

Real benefit here: the integration API sidesteps Protect's **login throttle**
(the whole `paceConnect`/retry dance in `client.ts`) since it's stateless
key auth — so it's a more robust default for scripted/repeated calls once a key
is configured.

### 2C. Integration-only extension (net-new capability)

| Command | Endpoint | Kind |
|---|---|---|
| `cameras stream <ref>` | `GET .../cameras/{id}/rtsps-stream` (provision/return RTSPS URL) | stream |
| `watch` / `subscribe` | WS `.../subscribe/devices`, `.../subscribe/events` | realtime |

- `watch [--events] [--devices]` — connect the realtime WebSocket and stream
  device-state changes / events to stdout (NDJSON). This is genuinely new — the
  CLI has no realtime surface today (events are polled).
- Optionally migrate `snapshot` / `cameras ptz` onto the official endpoints
  (`/cameras/{id}/snapshot`, ptz action) with the SDK path as fallback.

### 2D. Cross-cutting

- `status()` / `doctor`: in `auto`/`integration`, probe `GET /meta/info` and
  report which transport is live + Protect version.
- `README.md`: document `apiKey` + `source` + `watch`/`stream`.
- Regenerate the Claude skill so new commands surface to the assistant.
- Tests: integration-client unit tests + fallback firing on throttle/401.

### Phase 2 PR breakdown

1. PR: `integration-client.ts` infra + `apiKey`/`source` config + `meta/info` status probe.
2. PR: dual-support fallback for the 7 shared entities.
3. PR: `watch` (realtime subscribe) — the genuinely new capability.
4. PR: `cameras stream` (RTSPS) + optional snapshot/ptz migration.

---

## Coverage after both phases

| Entity | SDK list/get | integration | source |
|---|---|---|---|
| cameras | ✅ / ✅ (+stream, snapshot) | ✅ | dual (fallback) |
| lights | ✅ / ✅ | ✅ | dual (fallback) |
| sensors | ✅ / ✅ | ✅ | dual (fallback) |
| chimes | ✅ / ✅ | ✅ | dual (fallback) |
| viewers | ✅ / ✅ | ✅ | dual (fallback) |
| liveviews | ✅ / ✅ | ✅ | dual (fallback) |
| nvr | ✅ get | ✅ | dual (fallback) |
| doorlocks, bridges, ringtones, users, groups | ✅ / ✅ | — | sdk-only |
| events | ✅ list/get | — (poll) | sdk-only |
| realtime watch (devices/events) | — | ✅ | integration-only |

Net result: every Protect bootstrap entity gets `list` (+`get` where an `id`
exists), the seven shared entities gain an officially-supported, throttle-free
fallback transport, and realtime `watch` + RTSPS `stream` arrive as
integration-only extensions.

---

## Open item to confirm at implementation time

Exact Integration API paths/field names should be confirmed against
`developer.ui.com/protect` (the portal blocks automated fetch, so verify the
live spec when wiring `integration-client.ts`). Entity coverage and the
`/proxy/protect/integration/v1` base are confirmed; per-endpoint detail
(e.g. `rtsps-stream` vs `rtsps`, snapshot query params) is the only unverified
piece and does not affect the plan's structure.
