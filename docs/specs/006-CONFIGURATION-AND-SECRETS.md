---
plans: []
---

# Configuration and Secrets

`home` keeps two kinds of state on disk and draws a hard line between them.
Configuration is JSON under an XDG root, meant to be read by a human and
diffable. Secrets go to the OS keyring when the host has one, and to a
mode-0600 JSON file when it does not. Neither is ever supplied by the
environment — the CLI's environment variables are test seams and tuning knobs
only, as recorded in [`000-CLI-OUTPUT-CONTRACT`](./000-CLI-OUTPUT-CONTRACT.md).

The line matters because the two stores have different failure modes. A missing
config file means "not configured" and is a normal, expected state that the
command framework turns into exit code 3. A secret that fails to *load* is not
absent — it is a failure, and the whole of `src/core/secrets.ts` is built so
that the difference never blurs.

## One root, resolved on every access

`src/core/paths.ts` is the only place that knows where anything lives. Every
entry on the exported `paths` object is a getter, and each one re-reads
`XDG_CONFIG_HOME` (falling back to `~/.config`) through `xdgConfigHome()` at
`src/core/paths.ts:10`. That is deliberate, and the comment at
`src/core/paths.ts:4` records why: tests point `XDG_CONFIG_HOME` at a throwaway
directory before writing config or secrets, and if these were constants
evaluated at import time, whichever module happened to import `paths` first
would freeze the developer's real `~/.config/home` for the rest of the process
— silently redirecting every later test's "isolated" writes onto it. A getter
costs a `join` per call and makes the seam impossible to lose.

The isolation is belt-and-braces. `bunfig.toml` preloads
`src/__tests__/setup.ts`, which assigns `XDG_CONFIG_HOME` a fresh `mkdtempSync`
directory before any test file's module scope evaluates, so the default is
always throwaway even for a test that forgets to isolate itself
(`src/__tests__/setup.ts:5`).

Under `<xdg>/home` the CLI owns `config.json` (global settings,
`src/core/paths.ts:21`), `overview.json` (the project-to-service mapping read by
`src/core/overview.ts`), `modules/<name>.json` per module
(`src/core/paths.ts:30`), `secrets.json` for the file secrets backend
(`src/core/paths.ts:31`), and `update-check.json`, the best-effort cache behind
the update banner (`src/core/paths.ts:34`). Two more paths exist at runtime
without appearing in `paths`: `.secrets.lock`, composed in
`src/core/secrets.ts:123`, and the `<file>.partial` scratch name used by every
atomic write. Outside the XDG root, `paths` also resolves
`~/.claude/skills/home-<module>/` — those belong to
[`005-MODULE-SYSTEM`](./005-MODULE-SYSTEM.md).

## Two schemas, two files, one writer

`src/core/config.ts` holds the whole configuration layer, and it is short
because it does exactly two things.

Global configuration is a single `config.json` with `$schemaVersion` and four
optional fields (`src/core/config.ts:11`): `secretsBackend`, `defaultOutput`,
`logLevel`, and `updateCheck`. Only two of them are consulted anywhere —
`secretsBackend`, read on every secret operation via `backendOrDefault()`
(`src/core/secrets.ts:246`), and `updateCheck`, whose `false` silences the
preflight banner (`src/core/update.ts:178`). Nothing writes `updateCheck`; it is
set by editing the file.

Module configuration is one file per module, `ModuleConfigData` — a
`$schemaVersion` plus a flat bag of strings, numbers and booleans
(`src/core/config.ts:20`). Flatness is what makes the whole schema-driven
machinery downstream possible: a field is addressable as `module.key`, which is
what `configure`, the vercel sync, and the export commands all assume.

`loadModuleConfig` returns `null` for a file that does not exist, and that
`null` is the "not configured" signal — `src/core/citty.ts:108` turns it into
the `not_configured` config error for any module whose manifest requires
config. `loadGlobalConfig` instead returns a fresh `DEFAULT_GLOBAL`, because a
CLI with no global file is a working CLI, not an unconfigured one. A file that
exists but does not parse is neither: `readJson` throws a `SystemError` tagged
`config_parse` (`src/core/config.ts:37`) rather than pretending the file is
absent and overwriting it.

Both save paths funnel through `writeJsonAtomic` (`src/core/config.ts:41`),
which writes `<path>.partial` and renames it over the target. Rename is atomic
within a filesystem, so a reader never observes a half-written config and a
crash mid-write leaves the previous file intact. The file mode is passed to
`writeFileSync`, so it lands on `.partial` at creation and survives the rename.
`saveModuleConfig` asks for `0o600` (`src/core/config.ts:80`); `saveGlobalConfig`
takes the `0o644` default. The two files carry different things — the module
file holds controller URLs, account addresses, team slugs, and default repos,
while the global file holds only a backend name and preference flags.

Both loads pass through a migration hook — `migrateGlobal` and `migrateModule`
(`src/core/config.ts:48`). Both are currently identity functions, and both
schema versions are `1`. The hook exists so that a version bump has one obvious
place to land, and both save functions overwrite `$schemaVersion` with the
current constant rather than preserving whatever was on disk, so a file is
stamped as migrated the moment it is rewritten.

## Secrets are a different store with different rules

`src/core/secrets.ts` exposes five verbs — `getSecret`, `setSecret`,
`deleteSecret`, `listSecretKeys`, and the bulk `exportAll` / `importAll` — over
two interchangeable backends. Every secret is addressed by a flat account string
`module:key`, built by `account()` at `src/core/secrets.ts:65`, and both backends
store the same shape: a JSON object `{ $schemaVersion: 1, entries }` mapping
those account strings to values (`src/core/secrets.ts:104`). Only the medium
differs.

The keyring backend is `@napi-rs/keyring`, loaded through `tryLoadKeyring()`
(`src/core/secrets.ts:48`), which `require`s it lazily and memoizes the failure.
A host without libsecret gets `null` once and never pays for the attempt again.
The file backend is `<xdg>/home/secrets.json`, written by `writeFileStore` at
mode `0o600` with an explicit `chmodSync` after the write
(`src/core/secrets.ts:171`) so the mode is re-asserted even on a file that
already existed. It is plaintext JSON; the mode is the only protection it has,
which is why `home secrets export` prints a warning before writing
(`src/commands/secrets.ts:44`).

Backend selection is one line: the configured `secretsBackend`, or, absent one,
`keyring` if the module loads and `file` if it does not
(`src/core/secrets.ts:246`). Persisting a choice is `selectAndPersistBackend`,
which is just a read-modify-write of `config.json`
(`src/core/secrets.ts:338`). `probeKeyring()` (`src/core/secrets.ts:327`) is the
stronger check `home init` uses: it loads the module and actually reads an
account named `__probe__`, returning `true` when the read succeeds or fails as
"no such entry" and `false` on anything else. A keyring that loads but has no
daemon behind it therefore reports unusable rather than being discovered later,
mid-command.

## One keychain item, and the migration that produced it

Every secret on the keyring backend lives in a single item, service `home-cli`,
account `secrets`. The reason is on macOS: the keychain attaches an ACL to each
*item*, so an item-per-secret layout costs one "allow access?" dialog per
module, repeated every time the binary's identity changes. One item means one
grant (`src/core/secrets.ts:20`). The account name `secrets` cannot collide with
the layout it replaced, because every legacy account is a `module:key` string
and therefore contains a colon.

Consolidation also bought enumeration. `listSecretKeys(module)` filters the
store's keys by a `module:` prefix (`src/core/secrets.ts:319`) — something the
item-per-secret layout could not do at all, since a keychain cannot be listed by
service.

The pre-consolidation layout is migrated lazily, one key at a time, on read.
`getSecret` checks the consolidated store first; only on a miss does it look for
a legacy item, and only if it finds one does it take the lock, re-read, fold the
value in, write the store back, and delete the legacy item
(`src/core/secrets.ts:262`). The ordering is the interesting part and the
comment says why: a legacy read can pop a keychain dialog, so it happens
*before* the lock is taken, and the store is re-read *under* the lock because
another process may have migrated the same key in the meantime.

That lock is a cross-process `O_EXCL` lockfile at `<xdg>/home/.secrets.lock`,
and the rationale at `src/core/secrets.ts:110` is concrete: every mutation is a
read/modify/write of one shared value, so two processes each lazily migrating a
different key could each write a store missing the other's and then delete both
legacy items, losing a credential permanently. A holder that never released
(crashed before its `finally`) is detected by mtime and broken after
`HOME_SECRETS_LOCK_STALE_MS` (30 s); waiting past
`HOME_SECRETS_LOCK_TIMEOUT_MS` (10 s) raises `secrets_lock_timeout` rather than
proceeding unsynchronized (`src/core/secrets.ts:120`).

Migration also dictates the write ordering of the other two verbs. `setSecret`
writes the consolidated store first and *then* drops any stale legacy copy, so a
failure at the second step leaves the new value stored and consolidated reads
winning anyway (`src/core/secrets.ts:284`). `deleteSecret` does the opposite —
legacy first, then the store entry — because removing the store entry while a
legacy item survived would let the next read migrate the value straight back,
silently undoing something like `home google logout`
(`src/core/secrets.ts:300`).

`importAll` (`src/core/secrets.ts:369`) is the bulk form: one locked read, the
whole batch merged in, one write, then one legacy delete per row. Doing it
per-row would take and release the lock — and rewrite the keychain item — once
per secret.

## A failed read is never an absent secret

Two guards keep an unreadable store from being mistaken for an empty one.

`isNoEntry` (`src/core/secrets.ts:185`) matches only the "no matching entry"
family of messages, because `@napi-rs/keyring` returns `null` for a missing item
on macOS while other platforms throw. Everything else — a denied dialog, a
keychain failure — is re-raised as a `SystemError`. The comment states the
consequence being avoided: treating a failure as "absent" turns an unreadable
credential into a baffling remote 401, and lets a failed legacy delete report
success.

`validateEntries` (`src/core/secrets.ts:77`) rejects any decoded store that is
not a plain object of string values. A type assertion would establish nothing:
syntactically valid corruption such as `{"entries":[]}` would pass, migration
would assign a named property to the array, `JSON.stringify` would drop it, and
the legacy item would then be deleted — losing the secret. A corrupt store
refuses mutations instead of destroying data.

Both guarantees are pinned by `src/__tests__/secrets-keyring.test.ts`, which
mocks the keychain and asserts, among other things, that four secrets occupy
exactly one item, that a denied read makes `getSecret`, `setSecret`,
`deleteSecret`, `exportAll` and `importAll` all throw without clobbering
anything, and that the `entries`-as-array shape leaves a legacy item intact.

The same discipline reaches the command framework: `src/core/citty.ts:98`
resolves module config — which reads secrets — inside its own try/catch, so a
denied keychain dialog becomes a structured system error and the command never
proceeds to the network with a credential that failed to load.

## `configure` is the only thing that prompts

`src/core/configure.ts` turns a module's `configSchema` into an interactive
session. Field shape is declared by `ConfigField` (`src/core/types.ts:50`), and
`kind` selects the prompt: `boolean` becomes a confirm, `enum` a select,
`secret` a masked entry, and `url`/`string` a text line. All of it is written to
stderr, for the reason given in
[`000-CLI-OUTPUT-CONTRACT`](./000-CLI-OUTPUT-CONTRACT.md).

`url` is the one kind with built-in validation: `validatorFor`
(`src/core/configure.ts:21`) runs a `new URL(v)` check first and only then the
field's own `validate`, so a module declaring a URL field inherits URL-ness for
free and can still add rules on top. A validator returning a string re-prompts
with that string as the error; returning `null` accepts.

Defaults may be a literal or a thunk evaluated at prompt time
(`src/core/types.ts:56`). The live example is unifi's and protect's controller
URL, whose default is `defaultControllerUrl` — a function that shells out to
`ip route` / `route -n get default` to find the host's gateway
(`src/core/net.ts:5`). A thunk that throws is swallowed and treated as "no
default" (`src/core/configure.ts:131`), so a failed detection degrades to an
empty prompt rather than aborting setup.

`dynamicEnum` is the same idea for choices: an async function given the answers
gathered *so far* in this session. That partial-config argument is what lets
vercel's `defaultProject` list the projects of the team just selected two
prompts earlier (`src/modules/vercel/index.ts:36`), and unifi's `site` list the
sites of the controller just entered (`src/modules/unifi/index.ts:73`). A
`dynamicEnum` that throws warns and falls back to the static `enum`; if that
leaves no options at all, the field degrades to free text labelled "could not
fetch options" (`src/core/configure.ts:163`) rather than presenting an empty
menu the user cannot escape.

Secrets get a hand-rolled prompt (`src/core/configure.ts:57`) because the
`consola.prompt` types used for every other kind echo what is typed. It writes
its own frame to stderr, puts stdin in raw mode, echoes `•` per character,
handles backspace, and rejects on Ctrl-C. When stdin is not a TTY there is no
raw mode to enter, so it falls back to a plain text prompt. Because a stored
secret must never be redisplayed, the prompt shows no current value; it offers
`press enter to keep current` instead, and an empty answer with an existing
value returns that value unchanged (`src/core/configure.ts:183`).

After every field is answered, each field's optional `probe` runs against the
gathered config and its failures are collected rather than thrown
(`src/core/configure.ts:241`). A probe failure is not fatal: the user is shown
every failure and asked "Save anyway and run status later?", because a
credential can be correct while the service is merely unreachable right now.
Declining re-runs the whole prompt flow exactly once — `maxRetries` is 1 — and a
second round of failures aborts with `probe_failed`.

Only on success does anything get written, and in a fixed order: the config file
first via `saveModuleConfig`, then each collected secret via `setSecret`
(`src/core/configure.ts:264`). Secrets are accumulated in memory throughout the
session rather than written as they are answered, so an abandoned session leaves
no partial credential behind.

Two flags narrow the session. `--rotate` keeps every non-secret value from the
existing file and re-prompts only secrets — the credential-rotation case, where
re-typing a controller URL is pure friction. `--force` discards the *stored*
value of every field, so each prompt starts from the schema default instead of
from what is on disk — which is how a mistyped answer that has become the
prompt's own default gets replaced (`src/core/configure.ts:209` and `:217`).

A module whose setup is not a set of typed answers replaces the whole flow.
`configureRunnerFor` (`src/core/configure.ts:271`) returns
`ModuleManifest.configure` when the manifest declares one and the generic runner
otherwise; the Google modules use it to run a browser consent instead, described
in [`007-GOOGLE-AUTHORIZATION`](./007-GOOGLE-AUTHORIZATION.md). Those modules
still declare their `refreshToken` as a `secret` field they never prompt for,
because an undeclared secret is invisible to every schema-driven inventory in
this document — the comment at `src/modules/gdrive/index.ts:18` says exactly
that, and `src/__tests__/secrets-keyring.test.ts:292` pins it.

## Sharing a configured host with another one

`home vercel config push` / `pull` / `diff` move this CLI's own configuration
between machines, using Vercel *shared* environment variables as the transport.
They touch no Vercel project's environment; the shared-variable store is simply
a team-scoped key-value service the user already has credentials for.

Each value is transported under `HOME__<module>__<field>`
(`src/modules/vercel/sync.ts:20`). The shape is forced by Vercel: env names must
match `[A-Za-z_][A-Za-z0-9_]*`, which forbids the hyphen in a kebab-case module
name like `uptime-kuma`, so the module segment maps `-` to `_` on encode and
back on decode. That is bijective only because module names never contain
underscores — a property `src/__tests__/vercel-sync.test.ts:59` pins across the
whole registry, so a single `_` in the module segment can never be confused with
the `__` field separator. Vercel accepts mixed-case keys, so field names survive
verbatim and `insecureTLS` is not flattened. The `HOME__` prefix itself lives in
`src/modules/vercel/client.ts:17`, not in `sync.ts`, because the client filters
API requests by it and `sync.ts` imports the registry — the other direction
would be an import cycle.

Two things are excluded from the sync by construction. Fields marked
`hostLocal` are dropped by `syncableFields` (`src/modules/vercel/sync.ts:46`):
the flag means the value describes the host's own vantage point rather than the
service being reached (`src/core/types.ts:63`). The three that carry it are
sonos's speaker `subnet`, which depends on which VLAN this machine sits on, and
the `gt` and `gh` binary paths, which are wherever this machine happens to have
installed them. The `vercel` module itself is excluded by `syncableModules`
(`src/modules/vercel/sync.ts:42`) because syncing it would be circular — you
need `teamSlug` locally before a pull can run at all.

`collectLocal` (`src/modules/vercel/sync.ts:70`) reuses `resolveModuleConfig`,
so config and keyring secrets merge exactly the way a real command sees them,
and carries one fallback. A module can hold state without holding a config file:
gmail, gdrive and gcal persist nothing but a keyring-backed `refreshToken`, so
`resolveModuleConfig` — which starts from the config file — returns `null` for
them. In that case each declared *secret* field is read directly. Non-secret
fields are skipped in that branch, because without a config file they have no
storage and could not contribute anything.

`applyRemote` (`src/modules/vercel/sync.ts:131`) is additive by design: local
keys absent from the remote set are left alone, so a pull can never delete
configuration this host has and another does not. Values already equal locally
are reported as `unchanged` and not rewritten, which is what makes `--dry-run`
mean "what would change" and a second consecutive pull report nothing pending.
Booleans are coerced back from their transported string form before that
comparison (`src/modules/vercel/sync.ts:113`), so `insecureTLS: true` does not
appear to differ from `"true"` forever. Remote keys naming a module or field
this build does not know, or must not sync, land in `skipped` with a reason
rather than being written. Writes are grouped by module so each config file is
read and saved once.

`push` is additive in the same way: it creates keys that are missing and updates
the ones whose value differs, and never deletes
(`src/modules/vercel/commands/config-push.ts:62`). Created variables are written
as `type: 'encrypted'` targeting `development`, because only `encrypted` values
can be read back — `sensitive` ones never are, and Vercel rejects `sensitive`
for `development` anyway (`src/modules/vercel/client.ts:174`). `config diff`
reports key names in five buckets and deliberately emits no values at all
(`src/modules/vercel/commands/config-diff.ts:43`), since several of them are
secrets.

## The command surface

`home init` (`src/commands/init.ts`) creates the config directories and settles
the secrets backend once. If `secretsBackend` is already set it reports
`already_initialized` and stops, so re-running is safe and never re-probes.
Otherwise it runs `probeKeyring()`; a working keyring is selected silently. When
there is none, the fallback to a mode-0600 file is a decision the operator makes
explicitly — the prompt names the file and defaults to "no", and declining exits
with `no_backend_chosen` and the remedy (install libsecret, or run on macOS).
With no keyring *and* no TTY there is nobody to ask, so it fails with
`no_keyring_no_tty` rather than silently choosing the weaker backend.

`home config export` / `import` (`src/commands/config.ts`) move module config
files and nothing else — `collectConfigs` reads only `loadModuleConfig`, so no
secret can leave through this path. Export with no `--out` writes the JSON
document to stdout; with `--out` it writes mode-0600 and emits a one-line
confirmation instead. Import merges by default and, with `--replace`, first
deletes the config of every registered module absent from the incoming
document. Modules the running build does not know are warned about on stderr and
skipped.

`home secrets export` / `import` (`src/commands/secrets.ts`) is the secret
counterpart and is explicitly plaintext — it warns before writing and sets mode
0600 on the output. Export does not simply dump the store: `collectSecretRows`
(`src/commands/secrets.ts:19`) first reads every secret field declared by every
module, which on the keyring backend forces any straggling pre-consolidation
item into the consolidated one. Without that pass a partly migrated install
would export only what had already been consolidated.

`home doctor` (`src/commands/doctor.ts`) touches this layer only through
`resolveModuleConfig`, which it hands to `collectModuleStatuses` so every
module's readiness probe runs against the same merged config-plus-secrets view a
real command would see.
