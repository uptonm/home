# Sonos API Gap-Closure Plan

Action plan to give every Sonos entity `list`/`get` coverage and round out the
control surface on the existing **local UPnP/SOAP** transport, then optionally
layer the official **Sonos Cloud Control API** in as an extension for the few
things local can't do well (notably `audioClip`).

Strategy, in order:

1. **Phase 1 — close gaps on the local SOAP transport** (`@svrooij/sonos`), the
   surface the module already speaks. No auth, no cloud, richest control.
2. **Phase 2 — optional Sonos Cloud Control API** (`api.ws.sonos.com`, OAuth2):
   **extension only** for cloud-strength capabilities (`audioClip` notifications
   / TTS, remote/off-LAN control). *Not* a fallback transport — local SOAP stays
   the primary.

---

## Decision: keep the SDK (unlike Protect)

The Protect plan ditches its SDK because that SDK was a thin slice wrapped in a
Bun-compat tax. **Sonos is the opposite — keep `@svrooij/sonos`.** It does
genuinely hard work that we do *not* want to reimplement:

- SSDP discovery **and** `ZoneGroupTopology` parsing (household enumeration from
  one seed speaker across VLANs — the whole `seed`/`subnet` story in `client.ts`).
- SOAP envelope construction for **a dozen services** (AVTransport,
  RenderingControl, ContentDirectory, GroupRenderingControl, AlarmClock,
  MusicServices, DeviceProperties, …).
- **DIDL-Lite** metadata generation/parsing (`MetaDataHelper`) — the fiddly XML
  that every `play-uri` / `queue add` depends on.

So Phase 1 is purely *additive command surface* over the SDK we already have —
no transport rewrite.

---

## Current state

Transport: local UPnP/SOAP via `@svrooij/sonos` `SonosManager`. Discovery is
SSDP multicast, or seed-host/subnet unicast via `ZoneGroupTopology` for
split-VLAN setups. Per-room resolution + coordinator-vs-device picking is
already factored into `withRoom` / `resolveRoom` / `pickCoordinator`.

| Entity | list | get | control |
|---|---|---|---|
| players | ✅ | ❌ | — |
| groups | ✅ | ❌ | ❌ (no join/leave/ungroup) |
| queue | ✅ | ❌ | clear, add (no remove / save / reorder) |
| favorites | ✅ | ❌ | ❌ (no play-favorite) |
| spotify-accounts | ✅ | — | — |
| playback | — | `now-playing` ✅ | play / pause / next / prev |
| volume | `get` ✅ | — | set, mute (per-**device** only) |
| notify | — | — | one-shot (host-file-on-LAN + save/restore state) |

Backing SOAP services already in use: `AVTransportService`,
`RenderingControlService`, `ContentDirectoryService` (`GetQueue`/`GetFavorites`),
`ZoneGroupTopologyService` (via the manager), `SystemPropertiesService` (Spotify
accounts).

---

## Phase 1 — Close gaps on local SOAP

Every item reuses the established `CommandSpec` + `withRoom`/`discover`
conventions and the existing `resolveRoom` helper. New `commands/<entity>.ts` +
`__tests__/sonos-<entity>.test.ts`, registered in `index.ts`.

### Tier 1 — finish the list-only entities (cheap)

| # | Command | Source | Notes |
|---|---|---|---|
| 1 | `players get <room>` | `DeviceProperties` + topology | full device detail: model, IP, software version, serial, LED, capabilities — beyond the `summarizePlayer` summary |
| 2 | `groups get <room>` | topology | one group's coordinator + members + per-member state |
| 3 | `favorites play <name>` | `ContentDirectory` + AVTransport | you `list` favorites but can't play one — resolve by title, enqueue/set-transport, play |

### Tier 2 — group control (the biggest functional gap)

You can *see* groups but not *change* them. All via `SetAVTransportURI` with
`x-rincon:<coordinatorUuid>` (join) / `BecomeCoordinatorOfStandaloneGroup`
(leave):

| # | Command | Notes |
|---|---|---|
| 4 | `groups join <room> <target>` | add `<room>` to `<target>`'s group |
| 5 | `groups leave <room>` | split `<room>` into its own standalone group |
| 6 | `groups party` / `groups ungroup` | party-mode (everyone joins one coordinator) / dissolve all groups |

### Tier 3 — playback + audio settings (get/set)

| # | Command | Source |
|---|---|---|
| 7 | `play-mode get/set` (repeat / repeat-one / shuffle / crossfade) | `AVTransport` GetTransportSettings / SetPlayMode + CrossfadeMode |
| 8 | `sleep-timer get/set` | `AVTransport` GetRemainingSleepTimerDuration / ConfigureSleepTimer |
| 9 | `eq get/set` (bass, treble, loudness, balance, night-mode, speech-enhance) | `RenderingControl` |
| 10 | `group-volume get/set` + `group-mute` | `GroupRenderingControl` (today volume is per-device only) |
| 11 | `seek <room> <pos>` | `AVTransport` Seek (REL_TIME) |

### Tier 4 — broader read surfaces (list/get)

| # | Command | Source |
|---|---|---|
| 12 | `playlists list/get/play` (Sonos playlists / saved queues `SQ:`) | `ContentDirectory` Browse |
| 13 | `library browse/search` (artists / albums / tracks / genres `A:`) | `ContentDirectory` Browse/Search |
| 14 | `music-services list` (configured streaming services) | `MusicServicesService.ListAvailableServices` |
| 15 | `alarms list/get` (+ enable/disable) | `AlarmClockService.ListAlarms` |
| 16 | `queue remove <pos>` / `queue save <name>` | `AVTransport` RemoveTrackFromQueue / SaveQueue |
| 17 | `line-in` / TV source play | `AudioIn` / `x-rincon-stream:` / `x-sonos-htastream:` |

### Phase 1 PR breakdown (stackable)

1. PR: Tier 1 (`players get`, `groups get`, `favorites play`).
2. PR: Tier 2 group control (`join` / `leave` / `party`) — highest functional value.
3. PR: Tier 3 settings (`play-mode`, `sleep-timer`, `eq`, `group-volume`, `seek`).
4. PR: Tier 4 read surfaces (`playlists`, `library`, `music-services`, `alarms`, `queue remove/save`, `line-in`).

---

## Phase 2 — Sonos Cloud Control API (extension only)

The official Sonos Control API (`https://api.ws.sonos.com/control/api/v1`) is
**cloud + OAuth2** (three-legged, scope `playback-control-all`, access tokens
expire 24h; the cloud relays commands to the household). Entities:
`households`, `groups`, `players`, `playback`, `playbackMetadata`,
`groupVolume`/`playerVolume`, `favorites`, `playlists`, `audioClip`, `settings`,
`homeTheater`, `audioClip`.

It is **not** a better primary than local SOAP (OAuth + cloud round-trip + token
refresh + no LAN-only operation), so it rides in as an **extension** for the two
things local genuinely can't match:

### 2A. `audioClip` — the headline win

`notify.ts` today is ~340 lines: snapshot transport/volume/play-mode/crossfade →
spin up a `Bun.serve` LAN file host → `SetAVTransportURI` → poll for playback end
→ restore all saved state, classifying load-bearing vs best-effort failures.

The cloud `POST /players/{playerId}/audioClip` plays a clip **over** current
audio with **no interruption and no state to restore** — the speaker mixes it in
and returns to normal automatically. That collapses the entire save/restore
machine into one call and removes the "restore failed → speaker left silent"
failure mode.

→ Add `notify --cloud` (and let `home tts synth | sonos notify` use it) backed
by `audioClip` when cloud creds are configured; keep the local file-host path as
the no-config default/fallback.

### 2B. Remote / off-LAN control

With a token, `playback`, `groupVolume`, `favorites`, `playlists` work from
anywhere (not just on-subnet). Useful for the same entities as Phase 1 but when
the CLI host isn't on the speakers' LAN.

### 2C. Infrastructure

- `src/modules/sonos/cloud-client.ts` — OAuth2 auth-code flow: a `sonos
  configure-cloud` step opens the consent URL, captures the redirect code,
  exchanges for access+refresh tokens, persists via `core/secrets`; auto-refresh
  on 401 (24h expiry). All requests `Authorization: Bearer` + `X-API-KEY`.
- Config: `clientId` / `clientSecret` / redirect + stored tokens. Gated behind
  `requiresConfig`-style optionality — **every Phase 1 command keeps working with
  zero cloud config**.
- `households`/`players` discovery to map local room names → cloud `playerId`s.

### Phase 2 PR breakdown

1. PR: `cloud-client.ts` OAuth infra + `configure-cloud` + token storage/refresh.
2. PR: `notify --cloud` via `audioClip` (the headline).
3. PR: cloud-backed `playback` / `groupVolume` / `favorites` for off-LAN control.

---

## Coverage after both phases

| Entity | local list/get | local control | cloud |
|---|---|---|---|
| players | ✅ / ✅ | — | ✅ |
| groups | ✅ / ✅ | join/leave/party | ✅ |
| queue | ✅ / get-by-pos | add/remove/clear/save | — |
| favorites | ✅ / ✅ | play | ✅ |
| playlists | ✅ / ✅ | play | ✅ |
| library | ✅ browse/search | — | — |
| music-services | ✅ | — | — |
| alarms | ✅ / ✅ | enable/disable | — |
| play-mode / sleep-timer / eq | ✅ get | ✅ set | settings |
| volume | ✅ device + group | set/mute | ✅ |
| notify | — | local file-host | **audioClip (no interruption)** |

Net result: every Sonos entity gets `list` (+`get`/`play` where it applies),
group management and audio/playback settings fill the control gaps, and the
cloud API arrives as an optional extension whose standout is replacing the
notify save/restore dance with a single non-interrupting `audioClip`.

---

## Open items to confirm at implementation time

- **`@svrooij/sonos` coverage** — confirm the SDK exposes `AlarmClockService`,
  `MusicServicesService`, and `GroupRenderingControlService` wrappers (it does
  for most; verify method names before wiring Tier 3/4).
- **Cloud OAuth redirect handling in a CLI** — the auth-code flow needs a
  loopback redirect listener (`Bun.serve` on `localhost`) to capture the consent
  code. Note this is **net-new**: the existing `src/modules/spotify` module uses
  the two-legged **client-credentials** grant (no user redirect), so there is no
  three-legged auth-code/loopback pattern in the codebase to reuse. This is a
  real chunk of the Phase 2 cost and reinforces keeping it extension-only.
- **`audioClip` model support** — older S1 / pre-2018 players don't support
  `audioClip`; keep the local file-host path as the fallback for them.
