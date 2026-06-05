# Spotify API Gap-Closure Plan

Action plan to expand the `spotify` module from search-only to full catalog
`list`/`get` coverage on the existing **client-credentials** auth, then
optionally add **user-scoped auth** (auth-code + refresh) for library/player —
a deliberate scope expansion that changes the module's character.

Strategy, in order:

1. **Phase 1 — catalog reads on the current client-credentials token.** No new
   auth. Preserves the module's identity: *resolve catalog entities → emit
   Sonos-playable `spotify:track:` URIs*.
2. **Phase 2 — user-scoped auth (optional).** Net-new three-legged auth-code +
   refresh flow unlocks the user's library, playlists, and Spotify Connect
   player. This is a genuine expansion beyond "resolve, don't play."

---

## Current state

Transport: Spotify Web API via `authedRequestJson`, **client-credentials**
(two-legged, app-only) token with in-memory cache + 401 refresh. One command:
`search` (track/album/artist/playlist) — container matches are resolved to a
representative `spotify:track:` URI with bounded-concurrency resolver calls and
structured per-match failure codes.

| Entity | search | get | list-children |
|---|---|---|---|
| track | ✅ | ❌ | — |
| album | ✅ | ❌ | ❌ (resolver reads first track internally) |
| artist | ✅ | ❌ | ❌ (resolver reads top-track internally) |
| playlist | ✅ | ❌ | ❌ (resolver reads first track internally) |

The internal resolvers (`resolveArtistTopTrack`, `resolveAlbumFirstTrack`,
`resolvePlaylistFirstTrack`) already hit `get`-style endpoints — Phase 1 largely
**promotes existing internal calls to first-class commands**.

---

## ⚠️ Deprecation constraint (drives Phase 1 scope)

As of **2024-11-27** Spotify **restricted several Web API endpoints to legacy
apps only** — apps created after that date (which a fresh `clientId` here is)
get `403/404`. **Avoid these in Phase 1:**

- Recommendations (`/recommendations`)
- Audio Features / Audio Analysis (`/audio-features`, `/audio-analysis`)
- Related Artists (`/artists/{id}/related-artists`)
- Featured Playlists, Category's Playlists (`/browse/featured-playlists`, `/browse/categories/{id}/playlists`)
- 30-second `preview_url`s

Phase 1 below uses **only still-available** catalog endpoints (search, get-by-id,
album/artist children, new-releases, categories, several/batch gets).

---

## Phase 1 — Catalog list/get (client-credentials, no new auth)

Each is a `client.ts` builder + `CommandSpec`, reusing `authedRequestJson` +
`extractSpotifyId` (accepts a `spotify:type:id` URI or open.spotify.com URL or
bare id). Every command keeps emitting a playable `uri` where one exists, so the
Sonos compose story is preserved.

### Tier 1 — get-by-id (promote search → fetch one)

| # | Command | Endpoint |
|---|---|---|
| 1 | `track get <ref>` | `GET /v1/tracks/{id}` (+ `/v1/tracks?ids=` batch) |
| 2 | `album get <ref>` | `GET /v1/albums/{id}` |
| 3 | `artist get <ref>` | `GET /v1/artists/{id}` |
| 4 | `playlist get <ref>` | `GET /v1/playlists/{id}` |

### Tier 2 — list children (full listings, not just the resolver's first track)

| # | Command | Endpoint |
|---|---|---|
| 5 | `album tracks <ref>` | `GET /v1/albums/{id}/tracks` (paged) — each row a playable track URI |
| 6 | `artist albums <ref>` | `GET /v1/artists/{id}/albums` |
| 7 | `artist top-tracks <ref>` | `GET /v1/artists/{id}/top-tracks` (promote `resolveArtistTopTrack`) |
| 8 | `playlist tracks <ref>` | `GET /v1/playlists/{id}/tracks` (paged) |

### Tier 3 — browse (still-available)

| # | Command | Endpoint |
|---|---|---|
| 9 | `new-releases [--market]` | `GET /v1/browse/new-releases` |
| 10 | `categories list/get` | `GET /v1/browse/categories` (+ `/{id}`) |

### Phase 1 PR breakdown (stackable)

1. PR: Tier 1 get-by-id (4 commands) + shared ref→id input handling.
2. PR: Tier 2 children listings.
3. PR: Tier 3 browse.

---

## Phase 2 — User-scoped auth (optional expansion)

Unlocks the user's own data + playback control. Requires **net-new
infrastructure**: a three-legged **auth-code + refresh-token** flow (the current
client-credentials grant cannot represent a user). The codebase has no auth-code
helper today — this is the same flow the Sonos cloud plan flags — so build it
once in `core/oauth` and share it.

### 2A. Infrastructure (one PR)

- `core/oauth` loopback auth-code helper: open consent URL, `Bun.serve` on
  `localhost` to catch the redirect `code`, exchange for access+refresh tokens,
  persist via `core/secrets`, auto-refresh on expiry.
- `spotify configure-user` step (PKCE, scopes below). Keep the existing
  client-credentials path for all Phase 1 catalog commands — user auth is
  additive.

### 2B. Library + profile (list/get)

| Command | Endpoint | Scope |
|---|---|---|
| `me` | `GET /v1/me` | — |
| `my playlists list` | `GET /v1/me/playlists` | `playlist-read-private` |
| `saved tracks/albums list` | `GET /v1/me/tracks`, `/v1/me/albums` | `user-library-read` |
| `top tracks/artists` | `GET /v1/me/top/{type}` | `user-top-read` |
| `recently-played` | `GET /v1/me/player/recently-played` | `user-read-recently-played` |

### 2C. Player (the character shift)

`GET /v1/me/player`, `/devices`, `/currently-playing` (list/get of playback
state + Spotify Connect devices), and transport (`PUT /play`, `/pause`, `/next`).
**This makes `spotify` able to *play*** — to Spotify Connect devices, distinct
from the current "hand a URI to Sonos" model. Flag explicitly: it broadens the
module's stated scope, so it's opt-in and clearly separated from the
Sonos-compose path.

### Phase 2 PR breakdown

1. PR: `core/oauth` auth-code helper + `spotify configure-user`.
2. PR: library + profile list/get.
3. PR: player list/get (+ optional transport).

---

## Coverage after both phases

| Entity | client-creds | user-scoped |
|---|---|---|
| track / album / artist / playlist | ✅ search + get + children | — |
| new-releases / categories | ✅ | — |
| me / my-playlists / saved / top / recently-played | — | ✅ list/get |
| player + devices | — | ✅ get (+ optional control) |
| ~~recommendations / audio-features / related-artists / featured~~ | ✗ deprecated for new apps | ✗ |

Net result: the catalog gains full get-by-id + children + browse on the existing
auth (preserving the URI-resolver identity), and an optional user-auth phase adds
library/profile/player — with the deprecated endpoints deliberately excluded.

---

## Open items to confirm at implementation time

- **Deprecation status** — re-confirm the 2024-11-27 restricted-endpoint list
  against current Spotify docs before wiring any browse/recommendation feature;
  the deprecation list has shifted over time.
- **Auth-code vs Sonos cloud** — `core/oauth` should be generic enough to back
  both Spotify-user and Sonos-cloud (and the Google modules); design it once.
