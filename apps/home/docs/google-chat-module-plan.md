# Google Chat Module Plan (greenfield)

Plan for a **new `gchat` module** — Google Chat (`chat.googleapis.com/v1`) — with
the same `list`/`get`-first shape as the existing modules. New module, so it
includes scaffold + shared Google OAuth, then the entity spine, then write/send.

> Separate diff from the Gmail and Drive plans, but all three share one piece of
> infrastructure (`core/google-auth`); whichever lands first builds it, the
> others depend on it.

---

## New-module scaffold (Phase 0)

Standard module layout (mirrors `src/modules/spotify`):

- `src/modules/gchat/index.ts` — `ModuleManifest` (name `gchat`, description,
  whenToUse, configSchema, commands, status).
- `src/modules/gchat/client.ts` — `requestJson` against the Chat REST API with a
  bearer token from the shared Google auth helper.
- `src/modules/gchat/configure.ts` — `runConfigure(manifest)`.
- Register the manifest in `src/registry.ts` (the only wiring step; skills are
  auto-generated from manifests).
- `status()` → `GET /v1/spaces?pageSize=1` (auth + reachability probe).

### Shared auth: `core/google-auth`

Google APIs need OAuth2. For a CLI acting as the user, use the **three-legged
auth-code + refresh** flow (no such helper exists yet — same one the Sonos-cloud
and Spotify-user plans flag). Build once, share across all three Google modules:

- Loopback redirect (`Bun.serve` on `localhost`) to capture the consent `code`,
  exchange for access+refresh tokens, persist via `core/secrets`, auto-refresh
  on 401.
- Config fields: `clientId`, `clientSecret`, stored tokens. Per-module **scopes**
  (Chat module requests Chat scopes only).
- Alternative noted for Workspace admins: a **service account with domain-wide
  delegation** (no interactive consent) — leave as a documented option, default
  to user OAuth.

**Auth scopes (read spine):** `chat.spaces.readonly`,
`chat.messages.readonly`, `chat.memberships.readonly`. Write adds
`chat.messages` (+ `chat.spaces` for membership/space management).

### ⚠️ Hard constraint

The Chat API is **Google Workspace only** — consumer `@gmail.com` accounts
cannot use it. The module's `whenToUse` and `configure` help must say so up front
(unlike Gmail/Drive, which work on consumer accounts).

---

## Phase 1 — Entity list/get spine

| # | Command | Endpoint | Kind |
|---|---|---|---|
| 1 | `spaces list` | `GET /v1/spaces` | list (paged) |
| 2 | `spaces get <space>` | `GET /v1/spaces/{space}` | get |
| 3 | `members list <space>` | `GET /v1/spaces/{space}/members` | list |
| 4 | `members get <space> <member>` | `GET /v1/spaces/{space}/members/{member}` | get |
| 5 | `messages list <space>` | `GET /v1/spaces/{space}/messages` (`filter`, `orderBy`) | list |
| 6 | `messages get <space> <message>` | `GET /v1/spaces/{space}/messages/{message}` | get |

Resolution helper: accept a space by resource name (`spaces/AAAA`) or by
display-name substring (resolve via `spaces list`), mirroring the
`resolveEntity`/`resolveRoom` pattern in other modules.

### Phase 1 PR breakdown

1. PR: scaffold + `core/google-auth` + `spaces list/get`.
2. PR: `members list/get` + `messages list/get`.

---

## Phase 2 — Send + attachments (write)

| # | Command | Endpoint | Notes |
|---|---|---|---|
| 7 | `messages send <space> <text>` | `POST /v1/spaces/{space}/messages` | text or card; thread reply via `messageReplyOption` |
| 8 | `messages delete <space> <message>` | `DELETE …/messages/{message}` | |
| 9 | `attachments get <…>` | `GET …/messages/{message}/attachments/{id}` | download |
| 10 | `reactions list <…>` | `GET …/messages/{message}/reactions` | |

### Lightweight alternative for send-only

Incoming **webhooks** let you post to a space with just a webhook URL — **no
OAuth**. Worth offering as a minimal `gchat notify --webhook <url> <text>` path
for users who only want to push alerts (e.g. from `home` cron/automation) without
the full OAuth setup. Listing/reading still requires OAuth.

### Phase 2 PR breakdown

1. PR: `messages send` (OAuth) + `gchat notify --webhook` (no-auth send-only).
2. PR: attachments + reactions + delete.

---

## Coverage target

| Entity | list | get | write |
|---|---|---|---|
| spaces | ✅ | ✅ | — |
| members | ✅ | ✅ | — |
| messages | ✅ | ✅ | send / delete |
| attachments | — | ✅ | — |
| reactions | ✅ | — | — |

---

## Open items to confirm at implementation time

- **Auth model** — confirm whether the intended use is user-as-self (OAuth) vs a
  Chat **app/bot identity** (service account); listing semantics differ (a user
  only sees spaces they're a member of; an app sees spaces it's installed in).
- **Workspace requirement** — verify against the target account type before
  building; consumer accounts will 403 the whole module.
- **`core/google-auth` shape** — design generic enough to also back the Gmail and
  Drive modules (per-module scope list is the only difference).
