# Gmail Module Plan (greenfield)

Plan for a **new `gmail` module** — Gmail API
(`gmail.googleapis.com/gmail/v1/users/me`) — with the same `list`/`get`-first
shape as the existing modules: scaffold + shared Google OAuth, the entity spine,
then send/modify.

> Separate diff from the Google Chat and Drive plans, but all three share
> `core/google-auth`; whichever lands first builds it.

---

## New-module scaffold (Phase 0)

- `src/modules/gmail/{index,client,configure}.ts` (mirrors `src/modules/spotify`).
- `requestJson` against the Gmail REST API with a bearer token from
  `core/google-auth` (the shared three-legged auth-code + refresh helper — see
  the Google Chat plan for its design; build once, share).
- Register manifest in `src/registry.ts`.
- `status()` → `GET /users/me/profile` (auth probe; returns email +
  message/thread totals).

**Auth scopes (read spine):** `gmail.readonly` (covers messages/threads/labels/
drafts list+get). Write adds `gmail.send`, `gmail.modify`, `gmail.labels`. Works
on **consumer and Workspace** accounts (unlike Chat).

---

## Phase 1 — Entity list/get spine

Gmail's killer feature is the **`q` search syntax** (`from:`, `subject:`,
`is:unread`, `newer_than:7d`, `has:attachment`, …) — surface it on `messages list`.

| # | Command | Endpoint | Kind |
|---|---|---|---|
| 1 | `messages list [--q <query>] [--label <id>]` | `GET /users/me/messages` | list (paged; returns id+threadId) |
| 2 | `messages get <id> [--format full\|metadata\|raw\|minimal]` | `GET /users/me/messages/{id}` | get |
| 3 | `threads list [--q]` | `GET /users/me/threads` | list |
| 4 | `threads get <id>` | `GET /users/me/threads/{id}` | get (all messages in thread) |
| 5 | `labels list` | `GET /users/me/labels` | list |
| 6 | `labels get <id>` | `GET /users/me/labels/{id}` | get (+ message/thread counts) |
| 7 | `drafts list` | `GET /users/me/drafts` | list |
| 8 | `drafts get <id>` | `GET /users/me/drafts/{id}` | get |
| 9 | `profile` | `GET /users/me/profile` | get (singleton) |

Note: `messages list` returns only ids — a `messages get` (batched) is needed to
hydrate subject/from/snippet. Offer `messages list --hydrate` that fetches
`format=metadata` for the page so the common "show my unread" case is one call
for the user. Attachments: `messages get-attachment <msgId> <attId>` →
`GET …/messages/{id}/attachments/{attId}` (base64url body).

### Phase 1 PR breakdown (stackable)

1. PR: scaffold + `core/google-auth` + `messages list/get` (+ `--q`, `--hydrate`).
2. PR: `threads list/get` + `labels list/get`.
3. PR: `drafts list/get` + `profile` + `get-attachment`.

---

## Phase 2 — Send + modify (write)

| # | Command | Endpoint | Notes |
|---|---|---|---|
| 10 | `send --to --subject --body [--attach]` | `POST /users/me/messages/send` | build RFC 2822 MIME, base64url |
| 11 | `drafts create` / `drafts send <id>` | `POST /users/me/drafts` (+ `/send`) | |
| 12 | `modify <id> --add-label --remove-label` | `POST /users/me/messages/{id}/modify` | mark read (`-UNREAD`), archive (`-INBOX`), star, etc. |
| 13 | `trash <id>` / `untrash <id>` | `POST …/{id}/trash` | |

> Writes are outward-facing (sending mail, mutating the user's mailbox) — gate
> `send`/`trash`/`modify` behind explicit confirmation per the harness's
> hard-to-reverse-action norms; never auto-send.

### Phase 2 PR breakdown

1. PR: `modify` + `trash`/`untrash` (label/read/archive — low blast radius).
2. PR: `send` + `drafts create/send` (confirmation-gated).

---

## Phase 3 — Settings + history (optional)

| Command | Endpoint |
|---|---|
| `settings filters/forwarding/vacation list/get` | `GET /users/me/settings/*` |
| `history list --since <historyId>` | `GET /users/me/history` (incremental sync) |
| `watch` | `POST /users/me/watch` → Pub/Sub push (heavyweight; likely out of scope for a CLI) |

---

## Coverage target

| Entity | list | get | write |
|---|---|---|---|
| messages | ✅ (`q` search) | ✅ | send / modify / trash |
| threads | ✅ | ✅ | — |
| labels | ✅ | ✅ | create/update/delete |
| drafts | ✅ | ✅ | create / send |
| attachments | — | ✅ | — |
| profile / settings | — | ✅ | — |

---

## Open items to confirm at implementation time

- **`core/google-auth`** — shared with Chat/Drive; only the scope list differs.
- **MIME building for `send`** — use a small RFC 2822 builder (to/cc/subject/
  body/attachments → base64url); confirm Bun has no built-in and pick a minimal
  approach.
- **Scope minimization** — default to `gmail.readonly`; only request
  send/modify scopes when the user opts into Phase 2 commands, to keep the
  consent screen least-privilege.
