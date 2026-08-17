---
plans: []
---

# Google Authorization

Google ships no first-party CLI for Gmail, Drive, or Calendar, so anything that
reads them must present its own OAuth client. `gmail.readonly` is a *restricted*
scope: an embedded client shared across installs would need Google's CASA
assessment. For a single-user, self-hosted CLI the correct model is bring your
own client — `rclone` works the same way — and that decision is what every other
shape in this subsystem follows from
(`apps/home/docs/google-setup.md`).

One Google Cloud project and one **Desktop app** OAuth client serve all three
Google modules. `apps/home/src/core/google-auth.ts` is the whole of the
mechanism: 537 lines holding the three-legged authorization-code flow, the
refresh-token grant, the access-token cache, and the bearer-request wrapper.
Nothing about it is Gmail-, Drive-, or Calendar-specific. A consumer supplies a
scope list and a module name; that is the entire per-module surface.

## The client is shared, the grants are not

`readSharedGoogleClient` (`src/core/google-auth.ts:51`) assembles the client
half from the `google` module's config (`clientId`) and its keyring secret
(`clientSecret`), returning `null` when either is absent. The `google` module
(`src/modules/google/index.ts`) owns nothing else: two config fields, one
`logout` command, and a `status` that reports which modules hold a grant.

`requireGoogleCredentials(module)` (`src/core/google-auth.ts:64`) is what every
API module calls. It reads the shared client, then that module's *own*
`refreshToken` secret out of that module's *own* namespace, and returns the
three-field credential set. The two failure modes throw `NotConfiguredError`
with distinct codes — `google_unconfigured` when the shared client is missing
(`:69`), `google_unauthorized` when this module has no grant (`:71`) — and the
comment at `:66` records why one error class serves both: `NotConfiguredError`
renders `module "x" is not configured — run \`home x configure\``, which is
already the exact remedy in both cases. Only the subject differs.

Per-module refresh tokens are not incidental. A Google password change revokes
any refresh token carrying Gmail scopes; Drive and Calendar grants survive it
because they are separate consents in separate namespaces. Sharing one token
across the three would couple all three modules to Gmail's revocation
lifecycle.

Config-file layout, the keyring and encrypted-file secret backends, and how a
namespace maps to storage are specified in
[`006-CONFIGURATION-AND-SECRETS`](006-CONFIGURATION-AND-SECRETS.md).

## The consent flow is an installed-app loopback flow

`runInstalledAppOAuth` (`src/core/google-auth.ts:435`) is the one inherently
non-headless piece in the CLI — it needs a human at a browser — which is why it
lives apart from the pure helpers above it in the file, all of which are
unit-tested without a network (`src/__tests__/google-auth.test.ts`).

It generates a `state` and a PKCE pair, then calls `server.listen(0,
'127.0.0.1')` (`:493`). Port `0` lets the kernel pick, and the redirect URI —
`http://127.0.0.1:<port>/` — is only knowable after the listen callback fires,
so it is built there and threaded into both the consent URL and the later code
exchange. Google accepts that URI without pre-registration because the client is
of type "Desktop app": for that client type any loopback port is valid, which is
the property that makes an ephemeral port possible at all (`:429`).

`buildAuthUrl` (`:263`) sends `response_type=code`, the space-joined scopes,
`state`, `code_challenge` with `code_challenge_method=S256`, and two parameters
that exist for one reason each: `access_type=offline` asks Google to issue a
refresh token at all, and `prompt=consent` forces it to re-issue one even when
the user has already authorized this client. Without the second, a re-run of
`configure` on an existing grant returns an access token and no refresh token,
and there is nothing to persist. `login_hint` is sent only when supplied.

PKCE is S256 throughout: `generatePkce` (`:237`) is 32 random bytes base64url'd
as the verifier and the SHA-256 of that as the challenge; `generateState`
(`:244`) is 16 random bytes. Both use unpadded base64url per RFC 7636.

`parseAuthRedirect` (`:285`) resolves the server's request URL against a dummy
`http://127.0.0.1` origin — only the query matters — and rejects in three ways
before returning a code: an `error` parameter throws `google_auth_denied`, a
`state` that does not match throws `google_state_mismatch`, and a missing code
throws `google_no_code`. The HTTP handler answers only `/` and `/?…` and 404s
everything else, because the browser also fetches `/favicon.ico` and only the
root path carries the code (`:469`). Success renders a small "close this tab"
page; failure renders the error message HTML-escaped.

A five-minute timer (`:487`) rejects with `google_auth_timeout`, and a single
`finish` guard closes the server, clears the timer, and closes the stdin reader
exactly once regardless of which path settles first.

`tryOpenBrowser` (`:399`) is best-effort and deliberately does nothing under
SSH: with `SSH_CONNECTION` or `SSH_TTY` set, `xdg-open` would at best fail and
at worst open a browser on a forwarded X display nobody is looking at (`:400`).
The consent URL is always printed to stderr regardless, so the browser launch is
never load-bearing. Everything this flow prints goes to stderr, per
[`000-CLI-OUTPUT-CONTRACT`](000-CLI-OUTPUT-CONTRACT.md).

## Pasting the redirect back is a first-class path

When the browser is on another machine, the loopback server is unreachable and
the redirect never arrives. So whenever stdin is a TTY, `runInstalledAppOAuth`
also opens a readline interface (`:510`) and races it against the HTTP server —
both paths are live simultaneously, and whichever produces a code first settles
the promise.

`parsePastedRedirect` (`:304`) accepts exactly two forms. Anything starting
`http://` or `https://` is handed to `parseAuthRedirect` and validated against
`state` identically to the loopback path. Anything matching `^[\w/-]+$` is taken
as a bare authorization code. Everything else throws
`google_paste_unrecognized`, whose message names the remedy: paste the full
redirect URL from the address bar.

A bare code carries no `state`, so it cannot be CSRF-checked — and it does not
need to be. The comment at `:300` records the reasoning: the code is useless
without the PKCE verifier that exists only in this process's memory, and a user
typing it into this terminal *is* the consent that `state` exists to
corroborate.

A bad paste does not kill the flow. `UserError` from the parse is reported with
a `✗` line and both paths stay open, because a typo or a stale paste should not
cost the user the whole consent round-trip. Anything else — notably a spent code
surfacing as `google_code_exchange_failed` — rejects, since that authorization
is gone either way (`:522`).

## Exchanging the code

`exchangeCodeForTokens` (`:338`) posts an `authorization_code` grant with the
client secret, the code, the same redirect URI the server bound, and the PKCE
verifier. A non-OK response throws `google_code_exchange_failed`.

A 200 that omits `refresh_token` throws `google_no_refresh_token`
(`:360`–`:368`) rather than persisting a useless token set. Because
`prompt=consent` is always sent this is rare, and the message says what to do
when it happens anyway: revoke the existing grant at
`https://myaccount.google.com/permissions` and retry.

## Access tokens are cached per refresh token

`tokenCache` (`:89`) is a `Map` keyed by **refresh token**, not by module name
and not a single slot. The comment at `:86` gives the reason: the modules hold
different refresh tokens from separate consent grants with different scopes, so
a shared-process cache keyed any other way would let one module's access token
be served to another. Keying on the credential that produced the token makes
that impossible by construction.

Each entry holds the access token, an absolute expiry computed from
`expires_in` (defaulting to 3600 seconds), and the space-delimited `scope`
string when Google reports one. `getGoogleAccessToken` (`:116`) serves the
cached value while `Date.now()` is more than `TOKEN_REFRESH_MARGIN_MS`
(60 000 ms, `:90`) short of expiry. The margin is what keeps a token from being
handed out moments before it dies mid-request.

Refresh failures are classified at `:144`: HTTP 400 or 401 means the refresh
token itself is bad — revoked, expired, or from a deleted client — and becomes
`google_refresh_rejected`, distinct from any other status, which becomes
`http_<status>`. Only the first tells the operator to re-run a `configure`.

`resetGoogleTokenCache` (`:93`) clears the map; `home google logout` and the
test suite are its callers. `getCachedAccessTokenExpiry` (`:98`) exposes an
entry's expiry, which `gdrive status` reports as `tokenExpiresIn`
(`src/modules/gdrive/index.ts:36`).

## Every API call goes through `authedRequest`

`authedRequest` (`:185`) mints a token, attaches `Authorization: Bearer`, and
returns the raw `Response` so callers can stream bytes — Drive downloads and
exports do — or inspect status themselves. On a 401 it deletes the cache entry,
refreshes, and retries **once** (`:197`–`:201`). One retry is the right number:
a 401 means the access token was revoked or rotated upstream, a fresh one either
fixes it or the grant itself is gone, and a second retry would only repeat the
second outcome.

`authedRequestJson` (`:205`) adds the ok-check and JSON parse, throwing
`http_<status>` with a 200-character body excerpt. Transport concerns below this
line — timeouts, 5xx retry with backoff — belong to `src/core/http.ts` and apply
unchanged.

## The error codes name the command that fixes them

Every failure in this subsystem carries a code, and the code is chosen so a
consumer can branch on it and an operator can act on it without reading a stack
trace. `UserError` becomes exit 1, `SystemError` exit 2, and
`NotConfiguredError` exit 3 (`src/core/errors.ts:31`), per
[`000-CLI-OUTPUT-CONTRACT`](000-CLI-OUTPUT-CONTRACT.md).

| Code | Raised at | What to do |
| --- | --- | --- |
| `google_unconfigured` | `:69`, `:118` | Run `home google configure` — the shared client ID/secret is absent |
| `google_unauthorized` | `:71`, `:121` | Run this module's `configure` — the client exists, this module has no grant |
| `google_refresh_rejected` | `:144` | The stored refresh token is dead (revoked, expired, password change) — re-run the module's `configure` |
| `google_no_refresh_token` | `:364` | Revoke the prior grant at `myaccount.google.com/permissions`, then retry |
| `google_auth_timeout` | `:488` | Nobody completed consent within five minutes — re-run `configure` |
| `google_state_mismatch` | `:290` | The redirect's `state` did not match — treat as CSRF and start over |
| `google_auth_denied` | `:288` | Consent was declined at Google's screen |
| `google_no_code` | `:292` | The redirect arrived with neither error nor code |
| `google_paste_unrecognized` | `:308` | Paste the full redirect URL, not a fragment of it |
| `google_code_exchange_failed` | `:354` | Google rejected the code — usually already spent or expired |

## Scopes are verified, not assumed

`getGrantedScopes` (`:167`) returns the scopes Google reported on the refresh
grant, split from the cached entry's `scope` field, or `null` when Google did
not report them. It refreshes only if nothing is cached, so it is nearly free
immediately after any authenticated request.

It exists because a grant can be *valid and insufficient*. A refresh token
minted before `gmail` gained write commands still reads mail perfectly and 403s
on every write. `gmail status` (`src/modules/gmail/index.ts:49`) closes that
gap: it fetches the profile, compares the granted scopes against `GMAIL_SCOPES`,
and on any missing scope returns a `config` failure with code
`insufficient_scope` naming both the gap and the fix — "run `home gmail
configure` to re-grant" (`:65`–`:73`). When Google reports no scopes at all the
status stays `ok` with `scopes: 'unknown'` rather than failing on missing
evidence. `src/__tests__/gmail-status.test.ts` pins all three branches.

`gcal` normalizes its status errors instead, mapping `google_unconfigured` to
`not_configured`, `google_unauthorized` to `unauthorized`, and both
`google_refresh_rejected` and `http_401` to `auth_failed`
(`src/modules/gcal/client.ts:332`). `gdrive status` reports the account,
storage quota, and cached-token expiry.

## The three consumers differ by one constant

`gmail`, `gdrive`, and `gcal` each hold a `client.ts` whose credential reader is
a one-line call into the shared helper — `readGmailCredentials`
(`src/modules/gmail/client.ts:30`), `readGdriveCredentials`
(`src/modules/gdrive/client.ts:25`), `readGcalCredentials`
(`src/modules/gcal/client.ts:26`) — and a scope constant beside it:

- `GMAIL_SCOPES` = `gmail.modify` + `gmail.settings.basic`
  (`src/modules/gmail/client.ts:22`). `modify` is the read+write spine;
  `settings.basic` is separate because filters are a settings surface that
  `modify` does not cover.
- `DRIVE_SCOPES` = `drive.readonly` (`src/modules/gdrive/client.ts:17`), kept
  minimal so a Drive consent never grants more than the read commands need.
- `GCAL_SCOPES` = `calendar.readonly` (`src/modules/gcal/client.ts:20`), which
  covers calendarList, events, and freeBusy.

The three `configure.ts` files are structurally identical, line for line. Each
reads the shared client and throws `google_unconfigured` if it is missing —
deliberately *not* `requireGoogleCredentials`, which would also demand the
refresh token this function exists to obtain — then calls
`runInstalledAppOAuth` with its scope constant, stores the refresh token under
its own namespace, and makes one verifying API call before declaring success.
Only the scope constant and that final call differ: `getProfile` for Gmail,
`getAbout` for Drive, and `getCalendarListEntry(…, 'primary')` for Calendar.
Each writes an `authorized …` line to stderr naming what it found.

These modules set `configure` on the manifest, which `configureRunnerFor`
(`src/core/configure.ts:272`) prefers over the prompt-driven `runConfigure`
described in [`005-MODULE-SYSTEM`](005-MODULE-SYSTEM.md), because setup here is
a browser consent rather than a set of typed answers.

Two consequences follow from `configure` writing a secret and no config file.
First, all three set `requiresConfig: false`, because the default is derived
from `configSchema.length > 0` (`src/core/citty.ts:88`) and would otherwise gate
every command behind a config file that never gets written. Second, each
declares a `refreshToken` field in `configSchema` that `configure` never prompts
for and that nothing types by hand. It is declared so schema-driven inventories
can see it: `collectSecretRows` walks every module's declared secrets
(`src/commands/secrets.ts:26`) and `collectLocal` falls back to reading declared
secret fields directly for modules with no config file
(`src/modules/vercel/sync.ts:63`). An undeclared secret is invisible to
`home secrets export` and to the Vercel sync. The comment at
`src/modules/gmail/index.ts:20` says exactly this.

## `google logout` forgets grants, not the app

`GOOGLE_API_MODULES` (`src/modules/google/index.ts:6`) is a hardcoded
`['gmail', 'gdrive', 'gcal']`. Both `logout` and the `google` module's `status`
iterate it: `logout` deletes each module's `refreshToken` where one exists,
resets the token cache, and reports which modules it cleared; `status` reports
the configured client ID plus the `authorized` / `unauthorized` split across the
same list.

`logout` revokes nothing at Google and leaves the shared client configured — it
forgets grants, not the app. Re-running a module's `configure` re-authorizes it.

`google` deliberately makes no network call in `status`. A client ID and secret
authenticate the Cloud project, never a user, so there is nothing reachable
without a grant; what is worth reporting instead is which modules hold one
(`src/modules/google/index.ts:54`).

`google` is registered ahead of `gdrive`, `gmail`, and `gcal` in
`src/registry.ts:20`, which matters because `home configure` runs every module's
configure in registry order (`src/commands/configure-all.ts:18`) and the three
API modules cannot authorize until the shared client exists.
`src/__tests__/google-shared-client.test.ts:92` pins that ordering.

## Keeping a working setup alive

The Console walkthrough lives in `apps/home/docs/google-setup.md`. Two facts
from it are load-bearing enough to survive anywhere the setup is discussed.

**The OAuth app must be published to Production.** An External consent screen
left in *Testing* issues refresh tokens that expire after **seven days**, which
means re-authorizing every module weekly. Publishing to Production removes the
expiry. Production here stays *unverified*, which costs only a 100-user lifetime
cap and a "Google hasn't verified this app" interstitial — both irrelevant for a
single user, and the interstitial is cleared with **Advanced → Go to (unsafe)**.
Verification and CASA are required only past 100 users.

**Three things break a working grant**, all of them recoverable by re-running
the affected module's `configure`: a Google password change (revokes any refresh
token carrying Gmail scopes, leaving Drive and Calendar intact), six months of
total inactivity, and explicit revocation at
`https://myaccount.google.com/permissions`.
