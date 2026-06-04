# UniFi API Gap-Closure Plan

Action plan to give every UniFi entity a `list` (and where it makes sense `get`)
command, then layer the official **Network Integration API** in behind the
existing private API as a fallback (dual-support entities) and as net-new
coverage (integration-only entities).

Strategy, in order:

1. **Phase 1 — close every gap on the private Network REST API** (`/proxy/network/api/...`),
   the surface the module already speaks. Richest data, fastest to ship,
   mirrors patterns already in `client.ts` + `commands/*.ts`.
2. **Phase 2 — add Integration API (`/proxy/network/integration/v1/...`)**:
   - as a **fallback** for the three dual-support entities (sites, devices, clients),
   - as an **extension** for integration-only entities (vouchers) and the
     officially-supported action endpoints.

All commands stay read-only / action-only — no config writes — consistent with
the current module.

---

## 0. Baseline — land the in-flight stack first

PRs #29–#33 are a **stack** (each branches off the previous, not `main`):

```
main ← #33 networks get ← #32 firewall list/get ← #31 clients get ← #30 wlans get ← #29 devices get
```

These must merge bottom-up (#33 first) before Phase 1 work lands, otherwise the
new branches will carry their diffs. After they merge, the covered matrix is:

| Entity | list | get |
|---|---|---|
| sites | ✅ | ~ (derived) |
| devices (`stat/device`) | ✅ | ✅ #29 |
| clients active (`stat/sta`) | ✅ | ✅ #31 |
| networks (`rest/networkconf`) | ✅ | ✅ #33 |
| wlans (`rest/wlanconf`) | ✅ | ✅ #30 |
| firewall rules (`rest/firewallrule`) | ✅ #32 | ✅ #32 |
| port-forwards (`rest/portforward`) | ✅ | ❌ |
| reservations (`rest/user`) | ✅ | ❌ |

Everything in Phase 1 below assumes that baseline.

---

## Phase 1 — Close all gaps on the private Network REST API

Each item follows the **established pattern**, no new infrastructure:

- `client.ts`: add `listX(cfg)` (and `getX(cfg, id)` where applicable), hitting
  `${url}/proxy/network/api/s/${site}/rest/<entity>` (or `/stat/<entity>`),
  returning `body.data`.
- `commands/<entity>.ts`: thin `CommandSpec` with a normalized row shape +
  `--json` example; `get` validates the arg (`missing_arg`) and returns
  `not_found` when empty. Reuse the `resolveDevice` / `matchNetwork` resolver
  pattern (MAC/name/id/substring) for entities people reference by name.
- `index.ts`: register the commands, extend `description` / `whenToUse`.
- `__tests__/unifi-<entity>.test.ts`: shape, sort, arg validation, not_found,
  spec wiring — `mock.module` spreading the real client (the firewall-PR pattern).

### Tier 1 — finish the list-only pairs (trivial, mirror #32)

| # | Command | Endpoint | Notes |
|---|---|---|---|
| 1 | `port-forwards get <name\|id>` | `rest/portforward/<_id>` | resolve by name or `_id` |
| 2 | `reservations get <mac\|name\|ip>` | over `rest/user` | reuse existing reservations filtering + a resolver |

### Tier 2 — config entities that resolve IDs already shown elsewhere

These make existing output dereferenceable (rules/wlans/users reference them):

| # | Command | Endpoint | Why |
|---|---|---|---|
| 3 | `firewall-groups list/get` | `rest/firewallgroup` | firewall rules (#32) reference these IDs |
| 4 | `port-profiles list/get` | `rest/portconf` | switch `port_table` references these |
| 5 | `wlan-groups list/get` | `rest/wlangroup` | `wlanconf` references these |
| 6 | `user-groups list/get` | `rest/usergroup` | bandwidth limits referenced by `rest/user` |
| 7 | `radius-profiles list/get` | `rest/radiusprofile` | referenced by WLANs/networks |

### Tier 3 — remaining config (`rest/*`) entities

| # | Command | Endpoint |
|---|---|---|
| 8 | `routes list/get` (static routes) | `rest/routing` |
| 9 | `dpi-apps list` / `dpi-groups list` | `rest/dpiapp`, `rest/dpigroup` |
| 10 | `radius-accounts list/get` | `rest/account` |
| 11 | `dynamic-dns list` | `rest/dynamicdns` |
| 12 | `tags list/get` (device tags) | `rest/tag` |
| 13 | `settings list/get <key>` | `rest/setting` (array of setting sections; "get" filters by `key`) |
| 14 | `hotspot2 list` *(optional)* | `rest/hotspot2conf` |

### Tier 4 — operational (`stat/*`) collections

| # | Command | Endpoint | Notes |
|---|---|---|---|
| 15 | `clients all` | `stat/alluser` | known clients incl. offline; lets `clients get` resolve disconnected MACs |
| 16 | `events list` | `stat/event` | supports `--limit`; recent network events |
| 17 | `alarms list` | `stat/alarm` | active/archived alerts |
| 18 | `rogue-aps list` | `stat/rogueap` | neighboring/rogue APs |
| 19 | `guests list` | `stat/authorization` | guest authorizations |
| 20 | `sessions list` | `stat/sessions` | historical connect/disconnect (time-ranged) |
| 21 | `dpi-stats site\|client` | `stat/sitedpi`, `stat/stadpi` | per-app/per-client traffic |

> Tier 4 items are list-only by nature (no stable `_id` get); a few take query
> params (`stat/event`, `stat/sessions` accept `start`/`end`/`_limit` via POST
> body on the private API) — expose those as `--limit` / `--since` flags.

### Phase 1 PR breakdown (small, reviewable, can stack like #29–#33)

1. PR: Tier 1 (`port-forwards get`, `reservations get`)
2. PR: `firewall-groups` (Tier 2 #3) — stacks on #32's pattern
3. PR: Tier 2 remainder (#4–#7)
4. PR: Tier 3 config entities (#8–#14)
5. PR: Tier 4 operational entities (#15–#21)

---

## Phase 2 — Integration API: fallback + extension

The Integration API (`/proxy/network/integration/v1`, Network app **v9.x+**) is
officially supported and versioned but **read + actions only** — it covers
**sites, devices, clients, vouchers** and a few action endpoints, and exposes
**none** of the `rest/*` config objects. So it does not replace Phase 1; it adds
stability for the three dual entities and unlocks vouchers + supported actions.

### 2A. Shared infrastructure (one PR)

New file `src/modules/unifi/integration-client.ts`:

```
base   = `${cfg.url}/proxy/network/integration/v1`
header = { 'X-API-KEY': cfg.apiKey, Accept: 'application/json' }   // same key field
```

- `appInfo(cfg)` → `GET /info` (version + capability/health probe).
- `resolveSiteId(cfg)` → `GET /sites`, map `cfg.site` **name** → integration
  opaque `id` (integration paths key on `siteId`, not the `default` site name
  the config stores). Memoize per process.
- `paginate<T>(path)` helper — loops `offset`/`limit`, concatenating `data`
  until `offset + limit >= totalCount` (integration lists are paginated; private
  API is not).
- Reuse `requestJson` + `insecureTLS` exactly as `client.ts` does.

Config (`index.ts` `configSchema`): add optional
```
key: 'source', kind: 'enum', enum: ['auto','network','integration'], default: 'auto'
```
with help noting that integration-API keys can differ from legacy keys, and that
`auto` prefers the private Network API and falls back to Integration.

### 2B. Dual-support fallback (sites, devices, clients)

Introduce a normalizer so both transports yield the **same row shape** the
existing `devicesList`/`clientsList`/site commands already emit (map integration
fields → current keys). Then wrap the three entities:

```
async function withSource(cfg, networkFn, integrationFn) {
  if (cfg.source === 'integration') return integrationFn()
  try { return await networkFn() }
  catch (e) {
    if (cfg.source === 'network') throw e
    if (isAuthOrNotFound(e)) return integrationFn()   // 401/403/404 → fall back
    throw e
  }
}
```

- `list/get` for **devices** and **clients** and **sites list** route through
  `withSource`. Output schema unchanged → no user-visible churn, just resilience
  when the private API path is disabled/blocked on a given firmware.
- Add `devices stats <ref>` → `GET .../devices/{id}/statistics/latest`
  (integration-only enrichment; resolve ref→id via integration `devices` list).

One PR; tests assert the fallback fires on 401/403/404 and is a no-op otherwise.

### 2C. Integration-only extension

| Command | Endpoint | Kind |
|---|---|---|
| `vouchers list` | `GET /sites/{id}/hotspot/vouchers` (paginated) | list |
| `vouchers get <id>` | `GET .../hotspot/vouchers/{id}` | get |
| `vouchers create` | `POST .../hotspot/vouchers` *(write — gate behind confirm/flag)* | create |
| `vouchers delete <id>` | `DELETE .../hotspot/vouchers/{id}` | delete |

Actions (mirror, with private API as fallback where one already exists):

| Command | Integration endpoint | Existing private equivalent |
|---|---|---|
| `devices restart <ref>` | `POST .../devices/{id}/actions {action:"RESTART"}` | — (new) |
| `devices poe-cycle` | `POST .../devices/{id}/interfaces/ports/{idx}/actions {action:"POWER_CYCLE"}` | `cmd/devmgr power-cycle` (keep as fallback) |
| `clients authorize-guest <ref>` | `POST .../clients/{id}/actions` | — (new) |

Keep `vouchers create/delete` and all actions read-confirmed: they are writes,
so respect any existing confirm/`--yes` convention before sending.

### 2D. Cross-cutting

- `index.ts`: register new commands; extend `description`/`whenToUse` (vouchers,
  device stats, restart/authorize).
- `status()`: in `auto`/`integration`, also probe `GET /info` so `doctor`
  reports which transport is live and the controller version.
- `README.md`: document the `source` setting + new commands.
- Regenerate the Claude skill (the module → skill generator) so the new commands
  surface to the assistant.
- Tests per entity (mock `requestJson`), plus pagination + site-id-resolution
  unit tests.

### Phase 2 PR breakdown

1. PR: `integration-client.ts` infra + `source` config + `status` probe.
2. PR: dual-support fallback for sites/devices/clients + `devices stats`.
3. PR: `vouchers` (read: list/get) — the genuinely new entity.
4. PR: actions (`devices restart`, integration `poe-cycle`, `clients authorize-guest`) + voucher writes.

---

## Coverage after both phases

| Entity | private list/get | integration | source |
|---|---|---|---|
| sites | ✅ / ✅ | ✅ list | dual (fallback) |
| devices | ✅ / ✅ (+stats) | ✅ list/get/stats/actions | dual (fallback) |
| clients (active + all) | ✅ / ✅ | ✅ list/get/action | dual (fallback) |
| networks, wlans, firewall rules+groups, port-forwards, port-profiles, wlan-groups, user-groups, radius, routes, dpi, dynamic-dns, tags, settings, reservations | ✅ / ✅ | — (no integration) | network-only |
| events, alarms, rogue-aps, guests, sessions, dpi-stats | ✅ list | — | network-only |
| vouchers | — | ✅ list/get/create/delete | integration-only |

Net result: every documented private-API entity has `list` (+`get` where an
`_id` exists), the three dual entities gain an officially-supported fallback
transport, and vouchers/device-stats/supported-actions arrive as integration-only
extensions.
