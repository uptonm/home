# UniFi Protect API Gap-Closure Plan

Action plan to (0) replace the `unifi-protect` SDK with an explicit
`requestJson`-style client like the Network module, (1) give every Protect
entity `list`/`get` coverage on that client, then (2) layer the official
**Protect Integration API** in behind it as a fallback + extension.

Decision (confirmed): **private API + cookie auth is the primary transport;
the official Integration API is an automatic fallback for shared entities and
the home for realtime/streaming extensions** — the full dual-track below.

Strategy, in order:

0. **Phase 0 — drop the SDK, build an explicit private-API client**
   (cookie/CSRF auth + `requestJson` over `/proxy/protect/api/...`). Removes the
   `unifi-protect` + `undici` deps and the Bun-compat workarounds.
1. **Phase 1 — close every list/get gap** on that explicit client (richest data:
   the full bootstrap, all entity types, all fields).
2. **Phase 2 — official Protect Integration API**
   (`/proxy/protect/integration/v1/...`, Protect 6.x, `X-API-KEY`):
   - **fallback** for dual-support entities (cameras, lights, sensors, chimes,
     viewers, liveviews, nvr) — stateless key auth sidesteps the login throttle,
   - **extension** for integration-only capability (realtime `subscribe`
     WebSockets, RTSPS stream provisioning).

---

## Why drop the SDK

The module already fights the SDK and doesn't use the one piece that's hard to
replace:

- **Only a thin slice is used:** `login`, `getBootstrap`/`.bootstrap`,
  `getSnapshot`, `updateDevice`, `retrieve`, `getApiEndpoint`,
  `getWsEndpoint('talkback')`, `responseOk`. Every one maps to `requestJson` /
  `request` (see table below).
- **Bun-compat tax:** `undici-patch.ts` exists only because the SDK's undici
  internals don't run under Bun — it no-ops `Pool.compose` (which **kills the
  SDK's own retry layer**) and stubs `destroy`/`close`. Because retry is nuked,
  `client.ts` **re-implements retry + login-throttle pacing** and **silences the
  SDK logger** anyway.
- **Unused crown jewel:** the SDK's genuinely-hard feature — the **binary
  realtime "updates" WebSocket decoder** — is never invoked. `getWsEndpoint`
  only fetches a URL string.

Net: going explicit is likely **less** code, two fewer dependencies, native Bun
`fetch`, and reuse of `core/http.ts` retry/timeout instead of the hand-rolled
version. The only non-trivial thing we take on is the UniFi OS cookie login.

### SDK → explicit mapping

| SDK call | Explicit equivalent |
|---|---|
| `login(host,user,pass)` | `POST /api/auth/login` → capture `TOKEN` cookie + CSRF token |
| `getBootstrap()` / `.bootstrap` | `requestJson(GET /proxy/protect/api/bootstrap)` |
| `getSnapshot(cam)` | `request(GET /proxy/protect/api/cameras/{id}/snapshot?ts=…)` → `arrayBuffer()` |
| `updateDevice(dev,patch)` | `requestJson(PATCH /proxy/protect/api/{type}s/{id})` |
| `retrieve(url,init)` | `request` / `requestJson` directly |
| `getApiEndpoint('camera')` | trivial URL builder |
| `getWsEndpoint('talkback')` | one `GET` to the talkback-url endpoint |
| `responseOk(status)` | `res.ok` |

---

## Phase 0 — Explicit private-API client (foundational)

New `src/modules/protect/client.ts` (replacing the SDK wrapper):

- **Auth:** `login(cfg)` → `POST https://{host}/api/auth/login`
  `{username, password}`. Capture the `TOKEN` cookie from `Set-Cookie` and the
  CSRF token (`X-CSRF-Token` / `X-Updated-CSRF-Token` response header). Hold both
  on a session object; send `Cookie: TOKEN=…` on every request and
  `X-CSRF-Token` on mutations (PATCH/POST).
- **Throttle pacing:** keep the existing `paceConnect`/state-file logic — the
  login throttle still applies to cookie auth (the Integration API in Phase 2 is
  what removes it).
- **Core helpers** (all via `core/http.ts`, honoring `insecureTLS`):
  - `getBootstrap(cfg)` → `GET /proxy/protect/api/bootstrap`
  - `getSnapshot(cfg, id)` → `GET .../cameras/{id}/snapshot` (bytes)
  - `patchDevice(cfg, type, id, body)` → `PATCH .../{type}s/{id}`
  - `post(cfg, path, body)` / `get(cfg, path)` for ptz/talkback/events
  - `talkbackUrl(cfg, id)` → existing talkback endpoint
- **Drop:** `unifi-protect` + `undici` from `package.json`, delete
  `undici-patch.ts`, delete the SDK logger-silencing shim.
- **Refactor** all existing commands (cameras/ptz/led/talkback/snapshot/lights/
  events) onto the new client — behavior-preserving, covered by the existing
  `protect-control.ts` test plus new client unit tests (mock `requestJson`).

This is **one PR** and is a prerequisite for everything below.

---

## Phase 1 — Close all list/get gaps (on the explicit client)

### Baseline today

| Entity | list | get | control/action |
|---|---|---|---|
| cameras | ✅ | ✅ (id only) | ptz, led, talkback, snapshot |
| lights | ❌ | ❌ | ✅ on/off/toggle + brightness |
| events | ✅ (+`recent`) | ❌ | — |
| nvr, sensors, chimes, viewers, bridges, doorlocks, liveviews, ringtones, users, groups | ❌ | ❌ | — |

### Step 1.0 — shared resolver (prereq)

`src/modules/protect/resolve.ts` — pure + unit-testable, mirrors the network
module's `resolveDevice`/`matchNetwork`:

```ts
resolve<T extends { id?: string; name?: string }>(coll: T[], ref: string):
  | { kind: 'ok'; item: T }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; matches: T[] }
// order: exact id → exact name (case-insensitive) → unique name substring
```

Refactor existing commands onto it → **fixes the `cameras get` bug** (today it
matches id only, while ptz/led/talkback/snapshot accept name or id).

### Step 1.1 — list/get for every bootstrap entity

Each is the same shape: read the bootstrap collection for `list`, `resolve()`
for `get`. New `commands/<entity>.ts` + `__tests__/protect-<entity>.test.ts`,
registered in `index.ts`.

| # | Command | bootstrap key | Priority / why |
|---|---|---|---|
| 1 | `sensors list/get` | `sensors` | **highest** — door/window/motion/leak + temp/humidity/light; zero visibility today |
| 2 | `lights list/get` | `lights` | finish the control-only entity |
| 3 | `nvr info` | `nvr` (singleton) | controller info; mirrors `unifi controller info` |
| 4 | `doorlocks list/get` | `doorlocks` | smart locks (lock state, battery) |
| 5 | `chimes list/get` | `chimes` | doorbell chimes |
| 6 | `viewers list/get` | `viewers` | Protect Viewport displays |
| 7 | `bridges list/get` | `bridges` | UP connect bridges |
| 8 | `liveviews list/get` | `liveviews` | saved multi-camera layouts |
| 9 | `ringtones list` | `ringtones` | chime ringtone library |
| 10 | `users list/get` | `users` | Protect users/permissions |
| 11 | `events get <id>` | `GET .../events/{id}` | you `list` but can't fetch one |

### Phase 1 PR breakdown (stackable)

1. PR: shared `resolve()` helper + refactor existing commands (fixes `cameras get`).
2. PR: `sensors` + `lights` list/get.
3. PR: `nvr info` + `events get`.
4. PR: remaining entities (doorlocks, chimes, viewers, bridges, liveviews, ringtones, users).

---

## Phase 2 — Integration API: fallback + extension

`/proxy/protect/integration/v1` (Protect **6.x+**, `X-API-KEY`) covers
**cameras, lights, sensors, chimes, viewers, liveviews, nvr** (list/get, PATCH
as writes roll out, snapshot, RTSPS) and adds **realtime `subscribe`
WebSockets**. It does **not** cover bridges, doorlocks, ringtones, users, or
groups — those stay private-API-only.

### 2A. Infrastructure (one PR)

`src/modules/protect/integration-client.ts`:

```
base   = `${cfg.url}/proxy/protect/integration/v1`
header = { 'X-API-KEY': cfg.apiKey, Accept: 'application/json' }
```

- `appInfo(cfg)` → `GET /meta/info` (version + capability probe).
- Stateless `getJson(path)` via `requestJson` (+ `insecureTLS`) — **no login, no
  cookie, no throttle pacing**.
- Config (`index.ts`): add optional `apiKey` (`kind: 'secret'`) +
  `source: auto|private|integration` (default `auto`: prefer private API, fall
  back to integration). Keep `username`/`password` for the private path.

### 2B. Dual-support fallback (cameras, lights, sensors, chimes, viewers, liveviews, nvr)

Normalizer maps integration fields → the bootstrap-shaped rows Phase 1 emits,
then route list/get through:

```
async function withSource(cfg, privateFn, integrationFn) {
  if (cfg.source === 'integration') return integrationFn()
  try { return await privateFn() }
  catch (e) {
    if (cfg.source === 'private') throw e
    if (isAuthThrottleOrUnavailable(e)) return integrationFn()  // 401 / login throttle / unavailable
    throw e
  }
}
```

Real benefit: when a key is configured, the integration path is **throttle-free**
(stateless), making it a more robust default for scripted/repeated calls than
the cookie-login private path.

### 2C. Integration-only extension (net-new)

| Command | Endpoint | Kind |
|---|---|---|
| `watch [--events] [--devices]` | WS `.../subscribe/events`, `.../subscribe/devices` | realtime (NDJSON to stdout) — the CLI has no realtime surface today |
| `cameras stream <ref>` | `GET .../cameras/{id}/rtsps-stream` | provision/return RTSPS URL |

Optionally migrate `snapshot` / `cameras ptz` onto the official endpoints with
the private path as fallback.

### 2D. Cross-cutting

- `status()` / `doctor`: probe `GET /meta/info` in `auto`/`integration`; report
  live transport + Protect version.
- `README.md`: document `apiKey` + `source` + `watch`/`stream`.
- Regenerate the Claude skill so new commands surface to the assistant.

### Phase 2 PR breakdown

1. PR: `integration-client.ts` infra + `apiKey`/`source` config + `meta/info` status probe.
2. PR: dual-support fallback for the 7 shared entities.
3. PR: `watch` (realtime subscribe).
4. PR: `cameras stream` (RTSPS) + optional snapshot/ptz migration.

---

## Coverage after all phases

| Entity | private list/get | integration | source |
|---|---|---|---|
| cameras | ✅ / ✅ (+stream, snapshot) | ✅ | dual (fallback) |
| lights | ✅ / ✅ | ✅ | dual (fallback) |
| sensors | ✅ / ✅ | ✅ | dual (fallback) |
| chimes | ✅ / ✅ | ✅ | dual (fallback) |
| viewers | ✅ / ✅ | ✅ | dual (fallback) |
| liveviews | ✅ / ✅ | ✅ | dual (fallback) |
| nvr | ✅ get | ✅ | dual (fallback) |
| doorlocks, bridges, ringtones, users, groups | ✅ / ✅ | — | private-only |
| events | ✅ list/get | — (poll) | private-only |
| realtime watch (devices/events) | — | ✅ | integration-only |

Net result: the SDK and its Bun-compat workarounds are gone, every bootstrap
entity gets `list` (+`get` where an `id` exists), the seven shared entities gain
a throttle-free officially-supported fallback, and realtime `watch` + RTSPS
`stream` arrive as integration-only extensions.

---

## Open items to confirm at implementation time

- **Cookie/CSRF login shape** — `/api/auth/login` body + which response header
  carries the CSRF token (`X-CSRF-Token` vs `X-Updated-CSRF-Token`); confirm
  against a live controller / hjdhjd's `unifi-protect` source before deleting
  the SDK.
- **Integration endpoint paths/fields** — confirm against
  `developer.ui.com/protect` (portal blocks automated fetch). Entity coverage
  and the `/proxy/protect/integration/v1` base are confirmed; per-endpoint
  detail (e.g. `rtsps-stream` spelling, snapshot params) is the only unverified
  piece and does not affect the plan's structure.
