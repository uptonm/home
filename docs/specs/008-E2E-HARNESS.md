---
plans: []
---

# End-to-End Harness

`bun run home:e2e` runs the development CLI against the real homelab. It spawns
`bun src/index.ts` once per command, against the live UniFi controller, the live
Sonos speakers, the live Google and GitHub and Linear APIs, and the operator's
real secrets — and prints a report saying which of the 262 commands still work.

It is a manual pre-release gate, not a test suite. Nothing schedules it and
nothing hooks it into `build:install`. A person runs it before shipping a
binary, reads the report, and decides.

## The question it answers

`bun test` is offline by construction, so it can prove that a module's client
parses a payload correctly and can prove nothing about whether the payload still
arrives. Every interesting failure in this codebase is on the far side of that
line: a controller firmware upgrade renaming a field, an OAuth token expiring, a
keyring entry lost, a `gt` version changing its error text.

So the harness is deliberately **not** `bun:test`. It is a plain Bun program
under `apps/home/e2e/` — 988 lines across ten files — invoked by
`apps/home/package.json:21` (`"e2e": "bun e2e/run.ts"`) and by `home:e2e` in the
monorepo root at `package.json:15`. Living outside `src/__tests__/` is what
keeps `bun test` incapable of touching the house, and it buys a custom coverage
report that a test runner's pass/fail tally cannot express.

Nothing under `e2e/` reaches the shipped binary, which compiles `src/index.ts`
alone — see [`000-CLI-OUTPUT-CONTRACT`](000-CLI-OUTPUT-CONTRACT.md).

## Every spawn goes through one door

`e2e/cli.ts` is the only place the harness starts a process. `runCli`
(`e2e/cli.ts:70`) resolves the requested path against the registry before it
spawns anything and throws `RefusedError` twice over: once for a path no module
declares (`:77`), once for a command whose `effect` is `destructive` (`:78-80`).

The refusal is structural rather than procedural. A scenario cannot restart a
switch, cycle PoE on a port, delete a voucher, open a camera's talkback channel,
or toggle a wake alarm even by typo, because the string never becomes an argv —
the throw happens before `Bun.spawn`. Nine commands carry `destructive` today,
and the report counts them under `destructive (never run by design)`
(`e2e/run.ts:98`) so the number is visible rather than merely absent.

`findCommand` (`e2e/cli.ts:22`) searches `manifest.commands` only, which means
the framework's own subcommands — `configure`, `status`, `skill` — are
unreachable through `runCli` as well: they are attached by
`src/core/citty.ts:236-240` and appear in no manifest. The one deliberate
exception is `runStatus` (`e2e/cli.ts:85`), which checks only that the module
exists and then spawns `<module> status` directly, because preflight needs the
command that the guard cannot see.

The `effect` taxonomy itself is defined on `CommandSpec` in
`src/core/types.ts:31-37` and described in
[`005-MODULE-SYSTEM`](005-MODULE-SYSTEM.md); `src/__tests__/smoke.test.ts:31-35`
rejects any command that fails to declare one. The harness consumes that field
three ways: `read` commands are enumerated and run automatically, `write`
commands are reachable only from a hand-written scenario, and `destructive`
commands are refused. The classification is the safety model, so the comment on
the field names the harness explicitly, and the two commands that write a local
file — `protect snapshot` (`src/modules/protect/commands/snapshot.ts:8`) and
`tts synth` (`src/modules/tts/commands/synth.ts:6`) — carry `effect: 'write'`
with an inline note that this is what keeps them out of auto-reads.

Across the 17 registered modules that leaves 190 `read`, 63 `write`, and 9
`destructive`.

## Three phases per module

`runModule` (`e2e/module.ts:94`) is the whole of a module's run.

**Preflight** spawns `<module> status`. Exit code `3` means not configured, and
the module is reported *skipped*, not failed (`:101-105`) — an unconfigured
Gmail account is a fact about the machine, not a regression. Any other nonzero
exit skips it too, with the code in the reason (`:106-112`). Skipping is not
merely cosmetic: `e2e/run.ts:83-84` excludes a skipped module's commands from
the never-exercised list, so a module nobody has configured produces one line
rather than forty.

**Auto-reads** run every command with `effect === 'read'`, in declaration order,
one at a time (`e2e/module.ts:114-121`).

**Scenarios** run last, and only when `--reads-only` is absent
(`e2e/module.ts:123-132`).

## Scenarios are a literal, not a directory scan

`e2e/module.ts:16` is the entire discovery mechanism:

```ts
export const scenarios: readonly Scenario[] = [...sonosScenarios]
```

A `Scenario` is `{ name, module, run(ctx) }` (`e2e/scenario.ts:19-23`), and
`runModule` selects the ones whose `module` matches. `e2e/scenarios/sonos.ts`
holds all eight that exist: volume, mute, play-mode, EQ bass, group volume,
pause/play, group join/leave, and TTS notify. They cover the sonos writes;
`unifi` has none, because its only non-destructive write is `vouchers create`.

Every scenario is shaped snapshot → mutate → assert → restore.
`ctx.defer(fn)` (`e2e/scenario.ts:48`) pushes a restore step, and `runScenario`
drains them LIFO inside a `finally` (`:57-64`) so a failed assertion still puts
the house back. Two details in the file record why the obvious shortcuts fail:

- Restores must call `ctx.cliOk`, not `ctx.cli`. `runCli` resolves normally when
  a command fails — the failure lives in `exitCode` — so a restore written with
  plain `cli()` would leave the speaker changed while the scenario reported PASS
  (`e2e/scenario.ts:6-11`).
- The snapshot has to come first even when a fixed end state looks harmless.
  `mute-cycle` reads the current mute state before touching it, because forcing
  "unmuted" at the end would change the house whenever the speaker was
  deliberately muted (`e2e/scenarios/sonos.ts:32-34`), and `pause-play-round-trip`
  registers the resume *before* issuing the pause, so a throw midway still brings
  the music back (`:114-117`).

Two scenarios decline to run rather than perturb something they cannot rebuild:
`pause-play-round-trip` returns early when nothing is playing (`:112`), and
`group-join-leave` returns early when the test speaker is coordinating a group
with other members, because leaving would strand them and the original topology
cannot be reconstructed from this side (`:135-140`).

Outward-facing targets never appear inline. `e2e/fixtures.ts` names them —
`Living Room` and `Bathroom` for Sonos, `main` for Graphite, `uptonm/home` for
GitHub, and the `#alerts` channel id for Discord — and scenarios read them
through `ctx.fixtures`. A run of the sonos scenarios is audible in the living
room.

## Turning an `ArgSpec` list into an invocation

Half the surface takes required arguments, and none of them can be hard-coded:
device MACs, deployment ids, and message ids all change between runs.

`argProviders` in `e2e/args.ts:98-219` maps a command key (`"unifi devices get"`)
to a `Provider` — an async function returning `Record<string, string>` of
argument name to value. `autoRead` (`e2e/module.ts:44`) calls the provider,
hands the result to `buildArgv` (`:31-42`), and `buildArgv` walks the command's
declared `args` in order, emitting each value the way its `kind` requires: bare
for `positional`, `--name value` for `string` and `number`, and `--name` alone
for a `boolean` whose value is `"true"`. A value with no matching arg name is
dropped, so a provider may return more than one command needs.

Most providers chain off a sibling `list`. `firstField` (`e2e/args.ts:41`) runs
the list command and takes the first row that actually carries the field —
`pickField` (`:28`) scans rather than indexing row zero, so a nameless first row
does not poison the chain. `firstFieldIn` (`:51`) does the same through a
wrapper key, for the Google and Linear and Uptime Kuma endpoints that return
`{ messages: [...] }` rather than a bare array. `cachedJson` (`:11`) memoizes
each list by module, path, and args, so twenty `unifi ... get` providers share
one `list` round trip.

When live data cannot supply a value the provider throws `Unresolved`
(`e2e/args.ts:5`) and the read is reported *unresolved* with the reason, never
silently skipped. A command with required args and no provider is likewise
unresolved, with the detail `required args, no provider` (`e2e/module.ts:56-58`).
Unresolved does not fail the run; it appears in its own report section
(`e2e/run.ts:99-102`) and in the never-exercised list, which is what keeps the
suite honest as modules grow.

Four providers encode a hard-won fact about the upstream service, and each says
so where it lives:

- `spotifyRef` (`e2e/args.ts:66`) takes the canonical `id`, not the `uri`,
  because container matches rewrite `uri` to a playable `spotify:track:<id>` on
  successful resolution, destroying the container reference that `album get` and
  `playlist tracks` need.
- `scopedVercelDeployment` (`:82`) chains projects → project id → deployments
  scoped to that project, because the v6 endpoint behind `deployments list`
  leaks deployments from other scopes that the v13 team-scoped `deployments get`
  then rejects.
- `beszelContainerRef` (`:224`) walks systems until it finds one whose status is
  `up`, since the long-down PVE host sits high in the list and yields stale or
  empty container sets.
- The three `graphite` providers pin to `fixtures.graphiteTrunk` (`:193-196`) so
  reads work from an untracked worktree branch.

## What counts as a failure

`autoRead` grades a read on four things (`e2e/module.ts:60-86`). Exit `143` and
`137` are the harness's own kills, and get a detail that says timeout rather
than echoing the child's unrelated output. A JSON body carrying an `ok: false`
whose `code` appears in `environmentalCodes` (`:9-11` — today only
`graphite_untracked_branch`) grades *unresolved*, because it describes the
checkout rather than the command. Any other nonzero exit fails, with the first
300 characters of stderr. And exit `0` is not sufficient: every invocation
carries `--json` (appended by `spawnHomeCli`, `e2e/cli.ts:66-68`), so stdout
that does not parse means the read regressed while the process claimed success.

The exit-code taxonomy the harness reads against is the CLI's, defined in
[`000-CLI-OUTPUT-CONTRACT`](000-CLI-OUTPUT-CONTRACT.md).

`spawnHome` (`e2e/cli.ts:42`) enforces a 30-second budget with two timers: a
`SIGTERM` at the deadline and a `SIGKILL` five seconds later. The escalation is
not defensive padding — a child that traps or ignores `SIGTERM` would otherwise
wedge a pool lane forever, and `src/__tests__/e2e-cli.test.ts` spawns exactly
such a child to prove the second timer fires.

The run fails if any read or any scenario failed; unresolved reads and skipped
modules do not fail it (`e2e/run.ts:115`). `printReport` closes with
`RESULT: PASS` or `RESULT: FAIL`, and `main` exits `1` on failure (`:152-153`).

## Concurrency is per module, never per command

`pool` (`e2e/pool.ts`, 22 lines) runs a worker over every item with at most
`limit` calls in flight, clamps `limit` to the item count, and returns results
in input order regardless of completion order. `e2e/run.ts:135` drives it over
the module list with a default of 8 lanes, adjustable with `--concurrency`.

The unit of parallelism is the module, and it stops there: reads and scenarios
inside `runModule` are strictly serial, so no two commands ever mutate the same
device at once. `src/__tests__/e2e-pool.test.ts` pins both properties — the
limit is never exceeded, and the output order matches the input.

A worker that throws does not take down the run. `e2e/run.ts:140-146` catches,
marks that module failed, and synthesizes a single read result whose detail is
`harness error: …`, so one broken provider costs one module rather than the
report.

## Progress rendering, and why it does not break anything

`runModule` never writes to the console — the comment at `e2e/module.ts:89-93`
is explicit that this is what allows many modules to run at once. Instead each
module owns a `LiveState` record (`e2e/live.ts`) that it mutates as it advances
through `pending → preflight → reads → scenarios → done | skipped`, and the
display reads those records.

`startTui` (`e2e/tui.ts:36`) is a timer-driven in-place table: one row per
module in array order, a braille spinner at 100 ms, and a footer counting
running, done, and elapsed seconds. It repaints by moving the cursor up over the
previous block (`:51-54`) and hides the cursor for the duration. `e2e/run.ts:131`
starts it only when `process.stdout.isTTY`; otherwise the run prints one
completion line per module as it lands (`:138`), formatted by the same
`activity()` the table uses. `tui.stop()` runs in a `finally` (`:148-150`) so an
unexpected throw still restores the cursor and clears the interval.

This is the only live view in the repository, and it does not violate the output
contract because the harness is not the CLI. The contract governs `home`; the
harness is a separate entrypoint that *consumes* `home`'s stdout by parsing it
as JSON, and writes its own board and report to its own stdout. Argument errors
go to stderr (`e2e/run.ts:35`, `:39`, `:47`, `:52`) and exit `1`.

## Flags, and why the parser is unforgiving

`--dry-run` prints the execution plan and spawns nothing — per module, every
read command tagged `provider`, `no args`, or `UNRESOLVED (no provider)`, plus
the scenario names (`e2e/run.ts:59-74`). `--reads-only` drops the scenarios.
`--module <name>` narrows to one module. `--concurrency <n>` sets the lane count.

`parseArgs` (`e2e/run.ts:23`) rejects an unknown argument, a `--module` with a
missing or unknown value, and a `--concurrency` that is not a positive integer —
each with a message and `exit 1`. The comment above it records the reason
(`:18-22`): permissive parsing here fails *open*. A `--module` typo that fell
through to "no filter" would not narrow the run, it would select every module
and execute every write scenario against the house.

## What a run touches

Everything real. The spawned CLI resolves configuration and secrets exactly as
the installed binary does — see
[`006-CONFIGURATION-AND-SECRETS`](006-CONFIGURATION-AND-SECRETS.md) — so a run
uses production credentials for every configured module, and the only
requirement is that the child starts in `apps/home`, which `spawnHome` pins by
setting `cwd` to `REPO_ROOT` (`e2e/cli.ts:5`, `:44`).

Running against production configuration is write-safe by construction because
no enumerated command writes `~/.config/home`; the commands that do —
`configure`, `init`, `secrets` — are framework subcommands the guard cannot
reach.

Modules that are unconfigured or unreachable skip, so the harness degrades to
whatever the machine currently has: the report names each skipped module with
its reason, and the providers for those modules stay in `e2e/args.ts` so the
chains light up the moment someone configures them (`e2e/args.ts:164-166`).

## The harness's own logic is unit-tested offline

Four files under `src/__tests__/` import from `e2e/` and reach nothing:
`e2e-guard.test.ts` asserts that unknown modules, unknown commands, and
`unifi devices restart` all reject before a spawn; `e2e-args.test.ts` pins
`pickField` skipping empty fields and `unwrapItems` returning null when an empty
mailbox drops the key entirely; `e2e-pool.test.ts` pins the concurrency limit
and result ordering; `e2e-cli.test.ts` proves the `SIGKILL` escalation against a
`bun -e` child that traps `SIGTERM`.

The parts that cannot be tested offline — every provider chain, every scenario —
are verified by running the harness, which is the point of it.
