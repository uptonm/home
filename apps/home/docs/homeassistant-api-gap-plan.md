# Home Assistant API Gap-Closure Plan

Action plan to give the `assistant` (Home Assistant) module full `list`/`get`
coverage on the **REST API**, then add the **WebSocket API** as a second
transport — which is the *only* way to reach the registry entity classes (areas,
devices, entity-registry, floors, labels) and realtime state.

Strategy, in order:

1. **Phase 1 — close gaps on the REST API** (`/api/...`, Bearer long-lived
   token), the surface the module already speaks.
2. **Phase 2 — add the WebSocket API** (`/api/websocket`, same token): the
   registry (areas/devices/entities/floors/labels) is **REST-invisible** and
   only reachable here, plus realtime `watch`.

Same auth/token for both — no new config in either phase.

---

## How HA differs from the other modules

Unlike UniFi/Protect (where the "second API" is a separate official integration
API) HA's two transports are **the same official API in two protocols**. The
split is not optional/fallback — it's a **capability boundary**: REST exposes
states/services/history; the **registry is WebSocket-only**. So Phase 2 isn't a
nicety, it's the only door to a whole class of entities.

---

## Current state

Transport: HA REST API via `requestJson`, Bearer token. Entity resolution
(`matchEntity`: exact id → friendly_name → unique substring) is already factored
and unit-tested.

| Entity / capability | list | get | other |
|---|---|---|---|
| states | ✅ (`states list`, `--domain`) | ✅ (`state get`) | `states search` |
| services | ❌ | — | ✅ **call** (`service call`, + light/switch/climate/scene/script/automation wrappers) |
| config | — | ~ (status only) | — |
| history | ✅ | — | — |
| logbook | ✅ | — | — |

Client fns: `info`, `getConfig`, `listStates`, `getState`, `searchStates`,
`callService`, `resolveEntity`, `history`, `logbook`.

---

## Phase 1 — Close gaps on the REST API

Each item is a thin `client.ts` fn + `CommandSpec` + test, reusing
`resolveEntity` where a reference is taken.

| # | Command | Endpoint | Why |
|---|---|---|---|
| 1 | `services list [--domain]` | `GET /api/services` | you can `call` services but can't **discover** them — lists every domain + service + field schema |
| 2 | `events list` | `GET /api/events` | event types + listener counts; pairs with `events fire` (`POST /api/events/{type}`) |
| 3 | `calendars list` / `calendars get <id> --start --end` | `GET /api/calendars`, `GET /api/calendars/{entity_id}` | calendar entities + their events — a whole entity class with clean list/get |
| 4 | `template <jinja>` | `POST /api/template` | render a Jinja template server-side — powerful computed queries over state |
| 5 | `camera snapshot <ref>` | `GET /api/camera_proxy/{entity_id}` | grab a camera JPEG (parallels `protect snapshot`); resolve ref via `resolveEntity` domain `camera` |
| 6 | `error-log` | `GET /api/error_log` | tail the controller error log (parallels `unifi`/diagnostics) |
| 7 | `config get` | `GET /api/config` | promote the status-only config to a real command (version, components, unit system, location) |

Lower priority / write-side (round out, not list/get): `state set`
(`POST /api/states/{id}`), `check-config` (`POST /api/config/core/check_config`),
`intent` handling.

### Phase 1 PR breakdown (stackable)

1. PR: `services list` + `config get` (discoverability).
2. PR: `calendars list/get` + `events list`.
3. PR: `template` + `camera snapshot` + `error-log`.

---

## Phase 2 — WebSocket API: the registry + realtime

`GET /api/websocket`: connect, send `{type:"auth", access_token}`, then issue
command messages with incrementing `id`. Add `src/modules/assistant/ws.ts` — a
small connect-auth-request-once helper (open WS, auth, send one command, await
the matching `id`, close) so each registry command stays a one-shot like the
REST ones. Reuses the existing token; no new config.

### 2A. Registry entity classes (REST cannot see these)

| # | Command | WS command | Entity |
|---|---|---|---|
| 1 | `areas list/get` | `config/area_registry/list` | areas/rooms |
| 2 | `devices list/get` | `config/device_registry/list` | physical devices (manufacturer, model, area) |
| 3 | `entities list/get` | `config/entity_registry/list` (+ `…/get`) | registry metadata: area, device, disabled/hidden, unique_id — the join between a `state` and its device/area |
| 4 | `floors list` | `config/floor_registry/list` | floors |
| 5 | `labels list` | `config/label_registry/list` | labels |

This is the high-value unlock: it lets the module answer "what's in the living
room", "which device owns `sensor.x`", "list everything on the 2nd floor" —
impossible on REST today.

### 2B. Realtime `watch` (extension)

`watch [--entity <ref>] [--event state_changed]` — `subscribe_events`, stream
matching events to stdout as NDJSON. The module is poll-only today (history /
logbook are after-the-fact); this is genuinely new and parallels `protect watch`.

### Phase 2 PR breakdown

1. PR: `ws.ts` one-shot helper + `areas` + `devices` list/get.
2. PR: `entities` (registry) + `floors` + `labels`.
3. PR: `watch` realtime subscription.

---

## Coverage after both phases

| Entity / capability | REST | WebSocket |
|---|---|---|
| states | ✅ list/get/search | (realtime via watch) |
| services | ✅ list + call | — |
| calendars, events, config, error-log, template, camera | ✅ | — |
| history, logbook | ✅ | — |
| **areas, devices, entities-registry, floors, labels** | — | ✅ list/get |
| realtime state changes | — | ✅ `watch` |

Net result: REST gains the missing list/get surfaces (services, calendars,
events, config, camera, template, error-log), and the WebSocket transport
unlocks the entire registry — areas/devices/entities/floors/labels — plus
realtime, none of which REST can reach.

---

## Open items to confirm at implementation time

- **WS auth handshake under Bun** — confirm `Bun`'s `WebSocket` (or `ws`) handles
  the `auth_required → auth → auth_ok` sequence; the one-shot helper must wait
  for `auth_ok` before sending commands.
- **Registry `get` granularity** — some registries only expose `…/list` (no
  by-id `get`); `get` may be implemented as a client-side filter over `list`
  (same as the REST `searchStates` approach).
