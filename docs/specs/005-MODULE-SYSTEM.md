---
plans: []
---

# Module System

`apps/home` has no per-service code in its command layer. A service is a
`ModuleManifest` — a plain object describing what the module is called, what it
needs configured, what commands it offers, and how to probe its readiness — and
everything the user touches is derived from that object by generic machinery.
The CLI tree, the shell completion scripts, the readiness board, and the
generated Claude skills are four renderings of the same seventeen manifests.

Adding a service means writing one manifest and adding one line to
`src/registry.ts`. Nothing else in the framework changes, because nothing else
in the framework knows a service exists.

## The manifest is the whole interface

`ModuleManifest` (`src/core/types.ts:73`) carries eight fields. Three are
strings: `name`, which is both the config filename and the first argv token;
`description`, which becomes the subcommand's help line and the generated
skill's frontmatter; and `whenToUse`, which exists solely so the skill can tell
an agent when this module is the right one — it appears nowhere in the CLI
itself.

`configSchema` declares the typed fields `configure` prompts for.
`commands` is the module's own command surface. `status` is an async readiness
probe taking a resolved config and returning a `RunResult`.

Two fields are optional and both exist to describe a module that does not fit
the default shape. `requiresConfig` (`src/core/types.ts:85`) overrides the
default rule that any non-empty `configSchema` makes configuration mandatory;
its doc comment records why the escape hatch is needed — sonos discovers players
over SSDP multicast and needs no configuration at all, so its one `subnet` field
is worth offering but must not gate every command behind it. `configure`
(`src/core/types.ts:91`) replaces the generic prompt loop entirely, for modules
whose setup is a browser round-trip rather than a set of typed answers.

The shape of `ConfigField` (`src/core/types.ts:50`), the configuration file
layout, and secret storage are owned by
[006-CONFIGURATION-AND-SECRETS](006-CONFIGURATION-AND-SECRETS.md); the Google
authorization flow those `configure` overrides run is owned by
[007-GOOGLE-AUTHORIZATION](007-GOOGLE-AUTHORIZATION.md); the rendering of a
manifest into `SKILL.md` is owned by
[009-SKILL-GENERATION](009-SKILL-GENERATION.md).

## A command is data with one function attached

`CommandSpec` (`src/core/types.ts:29`) is a `path` (the argv tokens after the
module name), a `description`, an `effect`, a list of `ArgSpec`, a list of
example invocations, and `run`. `run` receives a `RunContext`
(`src/core/types.ts:16`) — the parsed args, the three global flag booleans, a
consola instance, and the resolved config — and returns a `RunResult`. It has no
writer, no exit code, and no knowledge of who called it; the reasoning behind
that separation and everything downstream of the returned `RunResult` belongs to
[000-CLI-OUTPUT-CONTRACT](000-CLI-OUTPUT-CONTRACT.md).

`ArgSpec` (`src/core/types.ts:5`) declares a name, one of four kinds
(`positional`, `string`, `boolean`, `number`), a description, and optionally
`required`, `default`, and `enum`. `argsToCitty` (`src/core/citty.ts:17`)
translates it into citty's `ArgsDef`, mapping `enum` onto citty's `options` and
forcing `required: false` onto positionals that do not say otherwise, which
`src/__tests__/citty-args.test.ts` pins alongside the case where a spec sets
`required` explicitly. `ArgSpec` has no alias field, so every flag
derived from a manifest is long-form; the two short flags that work anywhere —
`-h` from citty and `-v` from the root's own argv scan — are not declared by any
spec.

Arguments reaching `run` are filtered rather than passed through:
`pickRunArgs` (`src/core/citty.ts:51`) copies only the keys the spec declared,
so the global flags and citty's own bookkeeping never appear in `ctx.args`.

## `effect` is metadata, and only the harness reads it

Every command declares `effect: 'read' | 'write' | 'destructive'`. The doc
comment on the field (`src/core/types.ts:31`) defines the three by what they do
to the world: `read` observes only, `write` mutates state that is recoverable or
acceptable to perturb, and `destructive` is irreversible or outward-facing
without a containable target. Across the registry the split is 190 read, 63
write, 9 destructive.

The distinction that matters is who acts on it. In the shipped binary, nothing
does — `effect` is never consulted on any path through `src/core/citty.ts` or
`src/index.ts`. Its consumer is the end-to-end harness, which refuses outright to
execute a command marked `destructive`; that behaviour is owned by
[008-E2E-HARNESS](008-E2E-HARNESS.md). `src/__tests__/smoke.test.ts:31`
asserts every registered command declares one of the three values, which is what
keeps the classification honest as commands are added.

Guarding a mutation at runtime is therefore each module's own job, and the house
convention it follows is an explicit `--yes` rather than a prompt — stated
directly at `src/commands/upgrade.ts:74` ("a binary-mutating action never
prompts — it requires `--yes`") and implemented the same way in graphite's stack
mutations, linear's issue writes, and gmail's bulk triage.

## The registry is a static array

`src/registry.ts` imports seventeen manifests by name and puts them in one
exported array, with `moduleByName` derived from it (`src/registry.ts:22`).
There is no directory scan, no dynamic import, and no plugin resolution.

That is what lets `bun build --compile` (`package.json:19`) trace the entire
program from one entrypoint into a single self-contained binary: the module
graph is fully known before the process starts, so enumerating every module —
which `--help`, completion generation, `home status`, `home doctor`, `home
configure`, `home skill install`, `home secrets export`, and `home config
export` all do — costs an array iteration rather than any filesystem work.

## Every module gets three commands for free

`buildCommandTree` (`src/core/citty.ts:220`) turns one manifest into one citty
`CommandDef`. Before it looks at `manifest.commands` at all, it installs three
synthesized subcommands (`src/core/citty.ts:236`):

`configure` (`src/core/citty.ts:135`) runs `configureRunnerFor(manifest)`, which
dispatches to the manifest's own `configure` when it has one and to the generic
prompt loop otherwise (`src/core/configure.ts:271`). It adds two flags of its
own on top of the globals — `--rotate` to re-prompt secrets only, and `--force`
to ignore every existing value. Every failure it catches is reported as
`kind: 'user'`, keeping the thrown error's code where there is one and falling
back to `configure_failed`.

`status` (`src/core/citty.ts:168`) resolves config and calls `manifest.status`.

`skill` (`src/core/citty.ts:207`) rewrites that one module's `SKILL.md`. It is
the only one of the three that neither reads config nor can fail on a
not-configured module — regenerating documentation does not need credentials.

Because the three are inserted into `subCommands` before the module's own
commands, they always appear first in citty's usage output, ahead of the
module's leaves.

## Not-configured is decided before `run`, not inside it

`resolveModuleConfig` (`src/core/citty.ts:72`) reads the module's config file,
strips `$schemaVersion`, and overlays every `secret`-kind field from the secrets
store. It returns `null` when no config file exists — including for a module
whose only stored value is a secret, since the file is what it checks.

Both `makeUserLeaf` and `makeStatusCommand` compute `requiresConfig ??
configSchema.length > 0` and, when config resolution returns `null` for a module
that requires it, report `{ kind: 'config', code: 'not_configured' }` with a
message naming the exact `home <module> configure` to run. That is the contract:
a command that cannot possibly work reports so before touching the network, and
the module's `run` never has to defend against an empty config.

The gap is that neither branch returns — `src/core/citty.ts:108` and
`src/core/citty.ts:183` emit and then fall through to the code that would run
the command against `config ?? {}`, and only the `process.exit` inside `emit`
prevents it, unlike the config-resolution failure branches immediately above
them (`src/core/citty.ts:106`, `src/core/citty.ts:181`) which do return.

Config resolution failing is treated as a distinct and harder error, and the
comment at `src/core/citty.ts:98` says why: reading config reads secrets, which
can fail on a denied keychain dialog or a corrupt store, and a credential that
failed to load must never be silently replaced by an absent one.

The four modules that set `requiresConfig: false` are exactly the ones this
guard would misfire on. sonos needs no config to discover players. gmail,
gdrive, and gcal store nothing but a refresh token, written by their browser
consent flow rather than by `runConfigure`, so no module config file is ever
created for them and `resolveModuleConfig` would return `null` forever. Their
schemas still declare that token as a `secret` field, and the comments say
exactly why (`src/modules/gmail/index.ts:20`, `src/modules/gdrive/index.ts:18`):
an undeclared secret is invisible to every schema-driven inventory, including
`home secrets export` and the vercel config sync.

## Two levels of nesting, and the tree assumes it

`buildCommandTree` classifies each `CommandSpec` by `path.length`: length one
becomes a direct subcommand of the module, anything longer is grouped under its
first token (`src/core/citty.ts:226`). A group is a synthetic `CommandDef` whose
description is the literal `"<group> commands"` and whose children are the
specs that share that head token.

The comment above it (`src/core/citty.ts:221`) records the constraint plainly:
"Keep in sync with `moduleNode()` in `core/completion.ts` — both assume max
depth 2." The assumption holds — all 262 registered commands are depth 1 (35) or
depth 2 (227). A depth-3 path would be grouped by its first token and then
collide with its siblings on the last, silently losing commands rather than
failing.

## Errors carry a code, and a taxonomy that is partly unused

`src/core/errors.ts` defines `HomeError` with a string `code`, and three
subclasses: `UserError`, `SystemError`, and `NotConfiguredError`, the last of
which builds its own message from the module name so every "not configured"
string in the CLI is identical.

`systemErrorResultFor` (`src/core/citty.ts:43`) is what catches anything a
command throws. Its doc comment explains the one piece of judgement in it: it
adopts the thrown error's `.code` only when the error came from this taxonomy,
because a generic `Error` carrying `.code = 'ENOENT'` from Node or a third-party
library is not a code the operator can act on. Everything else becomes
`run_failed`.

What it does not adopt is the *kind*: every caught throw becomes `kind:
'system'`, so a `NotConfiguredError` or `UserError` raised inside `run` keeps its
code but loses its exit code. `home gmail messages list` with no Google grant
exits 2 carrying `code: 'google_unconfigured'`, while `home gmail status` on the
same machine exits 3 — because gmail's manifest `status` catches the error and
converts it to `kind: 'config'` by hand (`src/modules/gmail/index.ts`,
`src/modules/gcal/index.ts` do the same). `exitCodeFor`
(`src/core/errors.ts:31`) maps the three classes onto exit codes 1, 2, and 3
exactly as the contract in
[000-CLI-OUTPUT-CONTRACT](000-CLI-OUTPUT-CONTRACT.md) describes, and has no
callers anywhere in the codebase; the mapping that actually runs is the one
inside `emit`, keyed on `RunResult.kind`.

## Readiness is one probe per module, run concurrently

`collectModuleStatuses` (`src/core/status.ts:79`) runs every module's `status`
under `Promise.all` and reduces the results into a `RootStatusReport`. Each
module produces a `ModuleStatusReport` — the module name, whether it was
configured, one of `ok` / `error` / `not_configured`, and either the probe's
structured `data` or a message and code.

`collectOneStatus` (`src/core/status.ts:27`) contains every failure mode rather
than letting one bad module reject the aggregate: a config resolver that throws
becomes `code: 'config_failed'`, a probe that throws becomes
`code: 'status_failed'`, and a probe that returns `{ ok: false, code:
'not_configured' }` is folded into the `not_configured` board state rather than
counted as an error (`src/core/status.ts:63`) — which is how the Google modules,
which cannot use the framework's config guard, still show as "not configured"
rather than "unreachable". `src/__tests__/status.test.ts` pins all four cases.

The root state is derived, not stored: any error at all makes the whole report
`degraded`, otherwise any success makes it `ok`, otherwise `not_configured`
(`src/core/status.ts:89`).

`src/core/status-view.ts` renders that report as the human board — a header line
with the root state and the three counts, then one aligned row per module
showing a symbol and one of `ok` / `unreachable` / `not configured`. It takes
`color` as an argument and decides nothing itself; the gating rule is
[000-CLI-OUTPUT-CONTRACT](000-CLI-OUTPUT-CONTRACT.md)'s.

## The root command

`src/index.ts` assembles the whole binary in fifty-eight lines. It maps the
registry through `buildCommandTree` (`src/index.ts:24`), spreads the result into
a citty root alongside ten top-level commands, and calls `runMain`.

Three things happen before citty ever sees argv. `__update-check`
(`src/index.ts:19`) is a hidden internal command — the detached child the
preflight spawns to refresh the update cache — handled first so it stays silent
and never recurses into its own preflight. `--version` and `-v`
(`src/index.ts:29`) are answered by writing the version string and exiting;
`--verbose` anywhere in argv appends the build commit. And `preflight`
(`src/index.ts:35`) prints the "newer version available" banner, skipped for
`upgrade`, which reports version state itself.

The version scan tests the entire argv rather than the first token, so
`home unifi devices list --version` prints `1.1.0` and exits 0 without running
the command. No module command declares a `--version` flag, so nothing is
currently shadowed by this.

`globalFlags` (`src/core/citty.ts:11`) — `--json`, `--quiet`, `--verbose` — is
merged into every generated leaf and every synthesized configure/status/skill
command, so the three are genuinely universal below the root. `ctxFromArgs`
(`src/core/citty.ts:60`) is where they take effect on logging.

## Root-level commands

Ten commands sit beside the modules, all of them cross-cutting.

`init` initializes `~/.config/home` and picks the secrets backend, refusing to
guess when no OS keyring exists and stdin is not a TTY. `configure` walks every
registered module's configure flow in sequence, collecting per-module success
rather than aborting on the first failure. `status` renders the readiness board.
`doctor` is `status` plus a version check, and reports a literal
`telemetry: 'off (no-op)'` field. `skill install`
writes `SKILL.md` for every module. `secrets export`/`import` and `config
export`/`import` move credentials and module configuration between machines;
`collectSecretRows` (`src/commands/secrets.ts:19`) deliberately reads every
declared secret before exporting, because on the keyring backend that read is
what pulls a pre-consolidation entry into the single item, and without it a
partly migrated install would export only what had already been consolidated.
`completions` renders a shell script. `upgrade` replaces the binary from GitHub
Releases.

`overview ops` is the one root command that composes modules rather than
enumerating them. It calls vercel, uptime-kuma, and beszel client code directly
instead of shelling out to `home` (`src/commands/overview.ts:33`), and the
composition itself takes injected probes so the aggregate is testable without
any client (`src/core/overview.ts`). Correlation between the three services is
driven entirely by an explicit mapping in `~/.config/home/overview.json` and
never by name matching.

## Completion is a second tree over the same manifests

`src/core/completion.ts` builds a `CompletionNode` tree from the registry and
renders it for bash, zsh, and fish. It is a parallel structure rather than a
traversal of the citty tree: `moduleNode` (`src/core/completion.ts:71`)
reimplements `buildCommandTree`'s classification — same three synthesized
subcommands, same single-depth-versus-grouped split — and the two functions
carry sync comments naming each other (`src/core/citty.ts:221`,
`src/core/completion.ts:86`).

Flags are derived the same way and constrained the same way: `GLOBAL_FLAGS`
(`src/core/completion.ts:33`) mirrors `globalFlags` in `src/core/citty.ts`,
`CONFIGURE_FLAGS` adds `--rotate` and `--force`, and `flagsForArgs`
(`src/core/completion.ts:46`) skips positionals, since a positional is not
completable as a flag. `src/__tests__/completion.test.ts` checks that every
module appears, that each has the three free subcommands, that grouped commands
nest, and that positionals stay out of the flag lists.

The shape of the module half is derived from the same manifests and so cannot
drift; only the three synthesized descriptions and the two flag lists are
hand-copied from `src/core/citty.ts`, and they currently match. The root half is
different: `buildCompletionTree` hand-lists the top-level commands
(`src/core/completion.ts:125`) under a comment telling the reader to keep the
list in sync with `src/index.ts`. It is currently behind — `config` and
`upgrade` are wired into the root but absent from the completion tree, the
`secrets` node is modelled as a leaf although the real command has `export` and
`import` subcommands, and several descriptions and flag lists differ from the
`meta` the commands actually declare.

## The catalogue

Seventeen modules are registered, offering 262 commands between them plus the
three free ones each.

| Module | Surface |
| --- | --- |
| `unifi` | the UniFi Network controller — devices, clients, VLANs, reservations, SSIDs, port forwards, firewall rules, vouchers, and device/client actions |
| `protect` | UniFi Protect — cameras with PTZ/LED/talkback, lights, motion and smart events, snapshots |
| `assistant` | Home Assistant — states, services, events, calendars, automations, history, logbook, cameras, templates |
| `sonos` | Sonos players — playback, volume, queue, play-from-URI, one-shot notifications, now-playing |
| `spotify` | the Spotify catalog, emitting URIs that `home sonos play-uri` consumes |
| `tts` | speech synthesis to an audio file, composing with `home sonos notify` |
| `google` | the shared OAuth client credentials the three Google API modules authorize against |
| `gmail` | Gmail — search and read, plus bulk archive/label/mark-read/trash and routing rules |
| `gdrive` | Google Drive — listing by query language, metadata, binary download, native-doc export |
| `gcal` | Google Calendar — calendars, events, merged agenda, free/busy |
| `discord` | Discord channels and messages via a bot token |
| `github` | GitHub remote state via the `gh` CLI — repos, PRs, checks, Actions runs, issues, notifications, releases, code search |
| `graphite` | local stacked-branch state via the `gt` CLI, plus `--yes`-guarded stack mutations |
| `linear` | Linear issues, projects, cycles, teams, and `--yes`-guarded writes |
| `vercel` | Vercel projects, deployments, and domains, plus config and secret sync between machines |
| `beszel` | Beszel server monitoring — host and container status, resource pressure, alerts |
| `uptime-kuma` | Uptime Kuma monitoring — reachability, latency, certificates, incidents, maintenance |

What each module's individual commands do is not recorded here. That is what its
generated `home-<module>` skill is for, and duplicating it would guarantee one
of the two copies is wrong.
