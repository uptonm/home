# Google credential consolidation

Date: 2026-07-17
Branch: `worktree-google-cred-consolidation` (off `main` @ `5cb54f9`)

## Problem

Setting up a Google module today means a trip to the Google Cloud Console, then
pasting the same OAuth client ID and client secret into `home gmail configure`
*and* `home gdrive configure`, then running a separate `auth login` for each.
`docs/gcal-module-plan.md` plans a third module with an identical schema, which
would make it a third paste.

One Cloud project and one "Desktop app" OAuth client works for every Google API.
The duplication buys nothing.

## Constraints

- **The client ID cannot be eliminated.** Google has no first-party CLI for
  Gmail/Drive/Calendar, and `gmail.readonly` is a *restricted* scope — shipping
  an embedded client would require a CASA security assessment. BYO client ID is
  the correct design for a self-hosted CLI, exactly as `rclone` does it.
- **Single user, single account.** No multi-tenant concerns. The unverified-app
  100-user lifetime cap is irrelevant.
- **Greenfield.** No `gmail.json` or `gdrive.json` exists, and the secret store
  holds only `spotify`, `protect`, `assistant`, and `unifi` namespaces. A
  `home vercel env pull` left both modules `not_configured`, so Vercel has no
  Google credentials either. **No migration path is needed.**

## Decisions

### Shared client credentials, per-module grants

A new `google` module owns `clientId` and `clientSecret`. Each API module keeps
its own `refreshToken`.

Rejected: one shared refresh token covering all scopes. It saves one browser
click during a one-time setup, but a Google password change revokes any refresh
token *containing Gmail scopes* — so a single combined grant couples Drive and
Calendar to Gmail's revocation rules. Per-module grants confine that blast
radius, and keep each module's scope list and login flow unchanged.

### `google` is a real module, not an implicit shared namespace

`src/modules/google/index.ts` declares `configSchema: [clientId, clientSecret]`
and `commands: []`. `buildCommandTree` (`src/core/citty.ts:232-236`) auto-adds
`configure`, `status`, and `skill`, so `home google configure` exists for free.

`ModuleManifest.status` is required, so `google` implements one. It makes **no
network call** — client credentials alone cannot reach any API without a user
grant. It reports which of the Google modules currently hold a `refreshToken`,
answering "what is authorized right now". When client credentials are absent
`requiresConfig` is true (`configSchema.length > 0`), so `citty.ts:179` emits
`google: not configured` and exits before `status()` is reached.

Rejected: tagging `ConfigField` with a shared namespace so the first `configure`
prompts and later ones inherit silently. That adds a general mechanism to core
for exactly one consumer, and makes "where do my credentials live" depend on
which module you configured first. YAGNI.

### `configure` performs the OAuth flow; `auth login` is deleted

`ModuleManifest` gains one optional field:

```ts
configure?: () => Promise<void>
```

`makeConfigureCommand` and `src/commands/configure-all.ts` both call
`manifest.configure ?? runConfigure`. Then:

| Command | Behavior |
| --- | --- |
| `home google configure` | `runConfigure` — prompts for client ID + secret |
| `home gmail configure` | OAuth browser flow, stores `gmail:refreshToken`, verifies via `getProfile` |
| `home gdrive configure` | OAuth browser flow, stores `gdrive:refreshToken`, verifies via `getAbout` |

This gives every module one uniform setup verb and removes the two-step
`configure` → `auth login` that caused the confusion in the first place.

`src/modules/gmail/configure.ts` and `src/modules/gdrive/configure.ts` are
currently **dead code** — they export `configureGmail`/`configureGdrive`, which
nothing imports, because `citty.ts` calls `runConfigure(manifest)` directly.
They become the home for the real OAuth flow.

`gdrive`'s `auth logout` stays; revoking is a distinct action. This leaves gdrive
with an `auth` group containing only `logout`, and gmail with no logout at all.
That asymmetry predates this work and is deliberately left alone.

### Credential seam

`core/google-auth.ts` gains a client-only type — the existing
`GoogleOAuthCredentials` includes `refreshToken`, which the shared half does not
have — plus two readers:

```ts
export interface GoogleClient {          // new: GoogleOAuthCredentials minus refreshToken
  clientId: string
  clientSecret: string
}

readSharedGoogleClient(): GoogleClient | null
requireSharedGoogleClient(): GoogleClient   // throws SystemError google_unconfigured
```

Both read the `google` namespace directly (`loadModuleConfig('google')` +
`getSecret('google', 'clientSecret')`), which means `core/google-auth.ts` takes a
new dependency on `core/config` and `core/secrets`, and hard-codes the module
name `'google'`. That is a deliberate layering choice: this file is already the
declared shared home for every Google module, so the alternative — a cross-module
import from `modules/gmail` into `modules/google` — is worse coupling.

Gmail and gdrive build credentials as *shared client + own refresh token*. Their
`readGmailConfig(cfg)` / `readGdriveCredentials(cfg)` currently take `ctx.config`;
they lose that parameter and read both halves directly, since neither half comes
from the module's own config file any more. Both modules set
`requiresConfig: false`, so the failure surface is the typed errors that already
exist in `google-auth.ts` rather than the generic "module not configured":

- `google_unconfigured` → "run `home google configure`"
- `google_unauthorized` → "run `home gmail configure`"

Those codes and messages already exist; the file's header comment describes this
exact design ("designed to back every Google-API module"). This finishes what it
started rather than inventing a mechanism.

`refreshToken` stays declared in each module's `configSchema` so `secrets export`
and the Vercel sync can see it — per the warning at `gdrive/index.ts:31`, an
undeclared secret is invisible to schema-driven inventory.

### Secret layout

```
google:clientId        (new, shared)
google:clientSecret    (new, shared)
gmail:refreshToken     (unchanged)
gdrive:refreshToken    (unchanged)
```

`exportAll` (`src/core/secrets.ts:357`) walks the flat `module:key` store
generically, so `home vercel env push/pull` picks up the `google` namespace with
no changes.

### Registry ordering

`google` must be registered ahead of `gdrive` and `gmail` in `src/registry.ts`.
`configure-all` iterates the array in order, and gmail's OAuth flow fails
without client credentials. Ordering makes `home configure` work end to end.

**Known consequence:** once `configure` means OAuth, `home configure` will launch
browser tabs for gmail and gdrive mid-loop. It was already interactive, but this
is a real behavior change.

## Setup documentation

`docs/google-setup.md` — the one place explaining the Console walkthrough:

1. Create a Cloud project.
2. Enable the Gmail, Drive, and Calendar APIs.
3. Configure the consent screen (Google Auth Platform), user type **External**.
4. **Publish to Production.** Skipping this is the single biggest footgun: a
   project with an External consent screen and "Testing" publishing status is
   issued refresh tokens that **expire in 7 days**.
5. Create an OAuth client, type **Desktop app**.
6. `home google configure` → `home gmail configure` → `home gdrive configure`.

It also records that the "Google hasn't verified this app" screen is expected and
correct; that Calendar has no module yet (only `docs/gcal-module-plan.md`), so
enabling its API now just avoids a second Console trip later; and that a Google
account password change revokes Gmail-scoped tokens, forcing one re-run of
`home gmail configure`.

Linked from the `google` module's `whenToUse` so the generated skill points at it.

## Testing

- Unit tests for `readSharedGoogleClient` / `requireSharedGoogleClient` go in
  `src/__tests__/google-auth.test.ts`, alongside the existing pure-helper tests.
  These read the real config/secret store, so they need the same
  `XDG_CONFIG_HOME`-before-import setup `secrets-keyring.test.ts` uses — and are
  subject to the same order-dependence noted below.
- The OAuth browser flow and `runConfigure` are interactive and stay untested,
  consistent with how `runInstalledAppOAuth` is already treated.
- Gates that can actually run: `bun run typecheck` and `bun test`.

Existing tests this breaks:

- `src/__tests__/gmail-client.test.ts:97-102` asserts `readGmailConfig(cfg)`
  against a passed-in config object. Dropping that parameter breaks these; they
  are rewritten to seed the `google` namespace and `gmail:refreshToken` instead.
- `src/__tests__/gmail-client.test.ts:184` builds a `GmailConfig` literal
  containing `clientId`/`clientSecret`; that type narrows to `refreshToken` only.
- `src/__tests__/secrets-keyring.test.ts:293` asserts gdrive declares
  `refreshToken`, and still passes — the design keeps it declared. Only its test
  *name* ("even though only `auth login` writes it") goes stale; update the name.
- `src/__tests__/gdrive-client.test.ts:183` and all of `google-auth.test.ts` use
  `GoogleOAuthCredentials` directly and are unaffected — that type is unchanged.

### Known-red baseline

Three tests fail on untouched `main` in a full-suite run, all pre-existing
cross-file test pollution, none related to this work:

- `cross-process lock > a live foreign lock makes mutations time out` and
  `> a stale lock (crashed holder) is broken` — `secrets-keyring.test.ts` sets
  `XDG_CONFIG_HOME` at line 10 before importing, because `paths` resolves it at
  module load. Under a full run another file imports `paths` first, so the
  test's `lockPath` and the real `lockFile()` disagree. **Passes 25/25 in
  isolation** (`bun test secrets-keyring`).
- `groups leave (command) > makes the room a standalone coordinator` —
  `sonos-tier4.test.ts`'s mock leaks into `sonos-groups.test.ts`.

Verified: the real `~/.config/home/secrets.json` was **not** written by these
runs (mtime unchanged at 03:43:37, predating them).

Fixing test isolation is out of scope. Verify per-file; treat these 3 as
known-red.

### Verification gate

**This cannot be verified end to end in this branch.** There is no Google Cloud
project yet, so there is no client ID to consent against — `home gmail configure`
cannot be exercised. A green typecheck is not evidence the OAuth flow works.

Real verification is: follow `docs/google-setup.md`, create the project, then run
`home google configure` → `home gmail configure` and observe a live `getProfile`.
The doc unblocks its own testing.

Per `CLAUDE.md`, the work ends with `bun run build:install && home skill install`.
This is mandatory, not optional: gmail and gdrive both lose `auth login`, and a
new `home-google` skill appears. Stale skills would advertise a command that no
longer exists.

## Shipping

One PR, five commits:

1. `ModuleManifest.configure?` seam — `citty.ts` + `configure-all.ts` use
   `manifest.configure ?? runConfigure`. No behavior change; nothing sets it yet.
2. Add the `google` module; register it ahead of `gdrive`/`gmail`.
3. Convert gmail — shared client read, `configure.ts` becomes the OAuth flow,
   `auth login` deleted.
4. Convert gdrive — same, keeping `auth logout`.
5. `docs/google-setup.md`.

The pieces are useless apart: `google` is dead code until gmail and gdrive read
from it, and they cannot work until it exists. Splitting means PR 1 ships
something inert and PR 2 is the whole feature. Commit hygiene gives
bisectability without the ceremony.

## Out of scope

- **The `gcal` module.** The seam means it lands later with no credential work.
- Test isolation fixes for the sonos and secrets suites.
- The gmail-logout / gdrive-logout asymmetry.
- Dead `configure.ts` files in the other eight modules (same pattern; only
  gmail's and gdrive's are touched here because they gain real behavior).
