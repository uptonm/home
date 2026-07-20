# Gmail write primitives

Date: 2026-07-20
Branch: `worktree-gmail-write-ops` (off `main` @ `1f85e1b`)

## Problem

The `gmail` module is read-only (`gmail.readonly`). It can find and read mail
but cannot act on it: no archive, no label, no mark-read, no routing rules. That
makes it useless for the actual job it keeps getting asked to do — help triage a
large inbox (currently ~47k messages, ~24k unread), where the only tractable
approach is bulk action keyed on sender/pattern.

We want write primitives so an operator (human or agent) can execute a triage:
archive/label/mark-read/trash the existing backlog in bulk, and create routing
rules (filters) so future mail lands where it should.

## Constraints & decisions

### Scopes — `gmail.modify` + `gmail.settings.basic`, trash-only

`GMAIL_SCOPES` changes from `[gmail.readonly]` to
`[gmail.modify, gmail.settings.basic]`.

- `gmail.modify` is a superset of read — existing list/get commands keep working
  — and adds relabel, archive, trash, and label creation.
- `gmail.settings.basic` is the separate grant required for filters (routing
  rules). `gmail.modify` does **not** cover settings.

**Trash-only, deliberately.** "Delete" means move to Trash (recoverable ~30
days, then Google auto-purges). We do **not** request the full
`https://mail.google.com/` scope, so permanent deletion (`messages.batchDelete`)
is not reachable. A mistaken bulk op is always undoable. This was an explicit
decision.

**Re-consent is required.** Scopes are baked into the refresh token. Shipping
this means the operator re-runs `home gmail configure` once; browser consent
mints a new refresh token with the broader scopes, overwriting the read-only
one. No other module re-auths.

### One primitive powers most actions — `messages.batchModify`

`messages.batchModify` takes up to 1000 ids and an add/remove label-id set in a
single call. That one endpoint covers:

- **archive** → remove `INBOX`
- **mark-read** → remove `UNREAD`
- **label** → add `Label_x`
- **relabel** → arbitrary add/remove

**Trash is the exception.** `batchModify` does not accept the `TRASH` label in
`addLabelIds`; trashing goes through `messages/{id}/trash`, which has no batch
form. Bulk trash is therefore a bounded-concurrency map over per-message trash
calls, reusing the module's existing `mapWithConcurrency` helper. (The
implementer should confirm the `batchModify`-rejects-`TRASH` behavior against the
live API and keep the per-message path regardless — it is the documented one.)

### Trash is reversible from the CLI — `messages untrash`

Trashing removes `INBOX` and adds `TRASH`. Recovery uses the dedicated
`messages.untrash` endpoint (per-message, bounded concurrency, mirroring
`trashMessages`). Two consequences shape the `messages untrash` command:

- **Selection must include Trash.** A normal `messages.list` omits trashed
  messages, so untrash scopes its query to `in:trash` and sets
  `includeSpamTrash: true`; otherwise the backlog it needs to act on is
  invisible.
- **Untrash recovers to All Mail, not the inbox.** Empirically, neither the
  `untrash` endpoint nor `batchModify` removing `TRASH` restores `INBOX` —
  Gmail dropped that label on trash and there is no record of the pre-trash
  state. So untrash means "no longer pending deletion, searchable again," and
  the command says so; re-inboxing is an explicit `messages modify --add INBOX`.
  Keeping untrash to one clear job (matching Gmail's own verb) beats guessing
  at inbox restoration.

### Backlog vs. future — two mechanisms, both needed

A newly created filter applies only to **future** mail; the Gmail *web UI's*
"also apply to matching conversations" is a UI convenience the API's
`settings.filters.create` does not offer. So:

- **Backlog** (existing 47k) → `messages modify` (batchModify / trash).
- **Future** → `filters create`.

Both are in scope. Neither substitutes for the other.

### Thin primitives, orchestrated externally

The module gains **general write primitives only**. Sender profiling, deciding
which senders to archive/label/route, and sequencing a cleanup are **not** baked
into the tool — they are done per-session by the orchestrator (agent or human)
using the existing read commands plus these primitives. No `gmail triage`
engine, no rules-config file. (YAGNI: keeps the module simple, general, and free
of embedded triage policy.)

### Safety model — dry-run unless `--yes`

Every mutating command is **dry-run by default**, matching the `linear` module's
guarded-writes convention. Without `--yes`, a command resolves its selection and
prints the blast radius — the query, total matched count, a 10-row sample
(from/subject), and the exact label add/remove — then exits **without mutating**.
`--yes` is required to actually write. This is the guardrail that makes a
47k-inbox bulk op safe: the operator always sees the scope first.

### `status` verifies scopes, not just auth

Today `status` calls `getProfile`, which succeeds on *any* valid token — so an
old read-only grant would report "authenticated" and then fail every write at
call time with a 403 `insufficient scope`. `status` must surface a stale grant
up front.

Google's refresh-token grant response already returns a space-delimited `scope`
field (`RefreshTokenResponse.scope` exists in `core/google-auth.ts` today but is
discarded). We capture it into the token cache and expose a shared helper:

```
getGrantedScopes(creds): Promise<string[] | null>   // null = not reported
```

Shared on `core/google-auth` because `gcal`/`gdrive` will want the same check.

`status` then branches after the profile check:

- **All required scopes present** → `ok: true`; `data.scopes` lists granted (so
  it is diagnostic even on success).
- **Missing write scopes** (old-auth case) → `ok: false`,
  `code: 'insufficient_scope'`, message naming the missing scope and the fix:
  *"authenticated as X but missing scope `gmail.modify` — run `home gmail
  configure` to re-grant."* `data` still includes `emailAddress` + granted/missing.
- **Scopes unreported by Google** (rare) → do **not** hard-fail; report them as
  `unknown` rather than breaking a working setup.

## Component design

### `core/google-auth.ts`

- Capture `scope` from the refresh-grant response into `CachedToken`.
- Export `getGrantedScopes(creds): Promise<string[] | null>` — returns the
  granted scopes for these creds (triggering a token refresh if needed), or
  `null` when Google did not report them.

### `modules/gmail/client.ts`

New pure URL builders + API functions, reusing `authedRequest` /
`mapWithConcurrency`:

- `messagesBatchModifyUrl()`, `messageTrashUrl(id)`, `labelsCreateUrl()`,
  `filtersListUrl()`, `filtersCreateUrl()`, `filterDeleteUrl(id)` — pure, unit
  tested.
- `chunk<T>(items, size)` — pure id-chunker (≤1000), unit tested.
- `batchModifyMessages(cfg, { ids, addLabelIds?, removeLabelIds? })` — chunks
  ids and issues one `batchModify` per chunk (204 No Content; use
  `authedRequest`, not `authedRequestJson`).
- `trashMessages(cfg, ids)` — bounded-concurrency map over `messages/{id}/trash`.
- `createLabel(cfg, { name, ... })` → returns the created `GmailLabel` (id).
- `listFilters(cfg)` / `createFilter(cfg, { criteria, action })` /
  `deleteFilter(cfg, id)`.

Scope constants updated: `GMAIL_MODIFY_SCOPE`, `GMAIL_SETTINGS_BASIC_SCOPE`;
`GMAIL_SCOPES = [modify, settings.basic]`.

### `modules/gmail/commands/`

- **`messages modify`** — selection by `--q "<gmail query>"` **or**
  `--ids a,b,c`; actions `--add`/`--remove <labelIds>` plus sugar `--archive`,
  `--mark-read`, `--trash`. Resolves `--q` to ids by paginating `messages.list`,
  then batches. Dry-run unless `--yes`.
- **`messages untrash`** — inverse of `--trash`: selection by `--q` (auto-scoped
  to `in:trash`) or `--ids`, recovers via `messages.untrash`. Dry-run unless
  `--yes`. See the trash-reversibility decision above.
- **`labels create --name <name>`** → prints the new label id.
- **`filters list` / `filters create` / `filters delete <id>`** — `create` takes
  criteria flags (`--from`, `--to`, `--subject`, `--query`, `--has-attachment`)
  and action flags (`--add <label>`, `--archive`, `--mark-read`). `create` and
  `delete` are guarded by `--yes`.

### `modules/gmail/index.ts`

- Register the new commands.
- Update `description` / `whenToUse` (drop "Read-only — it does not send,
  delete, or modify mail"; describe the write surface + trash-only + dry-run).
- Rewrite `status()` per the scope-verification decision above.

## Testing

- Unit-test the pure surface: URL builders, `chunk`, and the dry-run
  preview/selection formatting. Exported pure functions, no network — repo
  convention.
- Run via **`bun run test`** (the isolated harness). **Never raw `bun test`** —
  it has wiped real secrets before (test-isolation incident, 2026-07-17).
- Manual verification after install: `home gmail status` on the current
  (read-only) grant should now report `insufficient_scope`; after
  `home gmail configure`, it should report all scopes present and a dry-run
  `messages modify --q ...` should print a correct preview.

## Out of scope

- Permanent deletion / `https://mail.google.com/` scope.
- Send / compose / drafts-create.
- Any triage engine, sender-profiling command, or rules-config file.
- Retroactive filter application (the API does not offer it; use
  `messages modify` for the backlog).
- Updating the root `CLAUDE.md` monorepo-path drift (separate concern).
