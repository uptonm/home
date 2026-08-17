---
plans: [005-SCHEMA-OUTPUT]
---

# CLI Output Contract

`apps/home` is a batch command runner, not an interactive terminal application.
Every invocation parses argv, does one unit of work, writes one payload, and
exits. Nothing it prints is ever redrawn.

That single sentence is the reason the presentation layer looks the way it
does, and it is the fact to check any proposed change against.

## The contract

Three guarantees hold for every command in every module:

1. **stdout carries the payload and nothing else.** One write, at the end.
2. **stderr carries everything else** — logs, prompts, progress, error text,
   the update banner.
3. **Exit code encodes the outcome**: `0` ok, `1` user error, `2` system
   error, `3` not configured.

`--json`, `--quiet`, and `--verbose` are global flags present on every leaf
command. `--json` switches the stdout payload to a single line of JSON and
drops the consola log level to silent.

## Data and presentation are already separate

A command never prints. `CommandSpec.run` returns a `RunResult`
(`src/core/types.ts`) — either `{ ok: true, data }` or `{ ok: false, kind,
message, code }` — and returns it to the framework. `emit()` in
`src/core/output.ts` is the single funnel through which every byte of stdout
passes, and the only place `process.exit` is called on a normal path.

What the separation does *not* yet carry is any statement of what `data` is:
the field is typed `unknown`, so `formatHuman` recovers the shape by inspecting
the value at runtime — a string passes through, an array of objects becomes TSV
under the union of every row's keys, and anything else falls to
`JSON.stringify(data, null, 2)`. That last branch is why `home github prs diff`
prints its patch JSON-escaped with literal `\n`: the patch is one field inside
an object, so it is re-encoded rather than emitted.

### The CLI relays rendered artifacts it never renders

Two commands return text that some other tool has already formatted, and the
contract has no way to say so.

`home github prs diff` returns `gh`'s patch. `home graphite stack list` runs
`gt log short --no-interactive` and returns `{ raw, rawTruncated, branches,
topology }`, where `raw` is gt's own ASCII graph (`◯ ◉ │ ─ ┴ ┘`), ANSI-stripped
and capped at 20,000 characters. The graphite module never composes that picture
and deliberately never interprets it — the glyphs are documented as decorative
in `src/modules/graphite/client.ts`, and real topology comes from separate
`gt info` calls as a flat `branches[]` array with a `parent` field.

Both are blobs that must survive untouched. Neither can currently say so, which
is what the declared shape below fixes.

The separation is structural, not a convention someone remembers to follow:
`run` has no access to a stdout writer, and `emit` has no access to the module
that produced the data.

`src/core/citty.ts` builds every command tree, and constructs the per-command
consola instance with both `stdout` and `stderr` pointed at `process.stderr`.
Logging therefore cannot reach stdout even by accident. `src/core/configure.ts`
writes its interactive prompts to stderr for the same reason.

## Human formatting

TSV is a deliberate choice, not a placeholder. It is the format that survives
`cut -f2`, `awk -F'\t'`, and `sort -k1`, and it is the reason human output is
still useful in a pipe. Column alignment would make the same rows prettier on a
terminal and unparseable everywhere else. TSV stays the default: no flag, same
bytes as today.

Nothing wraps. Piped `home --help` emits 28 lines longer than 80 columns, the
longest 247 characters, and every one of them arrives intact.

`src/core/status-view.ts` is the one hand-written view, used by `home status`.
It renders the readiness board as an aligned column of module rows, and takes
`color` as an explicit argument rather than detecting anything itself.

## A command declares the shape of its output

> **PLANNED** — [`005-SCHEMA-OUTPUT`](../plans/005-SCHEMA-OUTPUT.md)

`RunResult` carries `out`, a key naming a Zod schema exported from that module's
`output.ts`:

```ts
return { ok: true, data: clients, out: 'clientList' }
```

The formatter resolves the key and dispatches on the **schema's** shape rather
than guessing from the data's runtime shape:

| Schema | Rendering |
| --- | --- |
| `z.string()` | a text blob, emitted raw and never re-encoded |
| `z.array(z.object({…}))` | a table, columns in the shape's key order |
| `z.object({…})` | a record |
| no `out` key | the runtime-shape guessing described above |

Column order is therefore declared rather than derived, and `.meta({ label })`
supplies a header without polluting the type. This is what fixes
`home github prs diff`: it keeps returning `{ patch }` so agents parse what they
always have, and marks the field as the blob humans should see.

The key is resolved **before** `run` executes, so a bad `--sort` column fails
without hitting the network.

### Why a key and not the schema itself

A schema returned from inside `run` is only reachable once the command has
already done its work, and framework-level flags need the shape beforehand. A
key is also resolvable statically, so a test can walk every `CommandSpec` and
assert it points at a schema that exists — which is what replaces the
compile-time link a returned schema would have given.

### `--json` never resolves the schema

`data` is already the JSON payload, so `--json` output is byte-identical to
today and the 17 generated skills are unaffected. Schema resolution happens only
when an invocation needs to *understand* the shape rather than emit it.

That keeps Zod off the hot path. Measured as deltas on a minimal compiled
binary, so they add to the budget below rather than replacing it: **+1 ms when
Zod is present but not resolved, +9 ms when it is.**

The saving depends entirely on the build passing `--splitting`. Without it,
`bun build --compile` evaluates the dynamically imported chunk at startup
anyway, and every invocation pays the full +9 ms whether or not it resolves a
schema. This was measured both ways; it is not an assumption about how bundlers
behave.

## Formats

`--format` selects the renderer; `--json` remains as an alias for
`--format json`, because every generated skill emits it.

> **PLANNED** — [`005-SCHEMA-OUTPUT`](../plans/005-SCHEMA-OUTPUT.md)

| Format | Produced by |
| --- | --- |
| `tsv` (default) | in-house, unchanged |
| `json` | `JSON.stringify`, unchanged |
| `yaml` | `Bun.YAML.stringify` |
| `pretty` | `Bun.inspect.table` |
| `csv` | in-house, RFC 4180 quoting |

Four of the five need no dependency: two are already the runtime's. Zod is the
only package this adds, and `@oclif/table` — the one library that looks
purpose-built — is disqualified because it depends on `ink` and React 18, the
exact cost this spec rejects below.

### What the schema makes possible later

A declared shape is what a `--sort` or `--filter` flag would need in order to
reject an unknown column by name and to coerce a comparison to a field's
declared type. **Neither is built, and neither is planned.** This is recorded as
a property of the design, not as work.

## Colour is gated on the real terminal only

`src/commands/status.ts` decides colour with:

```ts
const color = process.stdout.isTTY === true && !process.env.NO_COLOR
```

There is no `supports-color` dependency and no `FORCE_COLOR` override. Under a
pipe the output is plain text even when the caller exports `FORCE_COLOR=1` —
verified: zero escape bytes. The CLI cannot be talked into writing ANSI into a
capture buffer.

## The consumers are agents, and they never see human output

`home` exists to back one generated Claude skill per module. Skills are written
by `src/core/skill.ts` from each `ModuleManifest`, and `commandInvocation()`
appends `--json` to **every row of every command table it generates**. All 17
installed `home-*` skills invoke the CLI in JSON mode.

So the human renderer serves exactly one caller: a person typing at a prompt.
It is not on the path that matters most, and improving it cannot improve agent
behaviour.

## Latency is a feature

The compiled binary answers in **~44 ms** (20 sequential `home --version` runs
in 0.88 s; `home --help`, which builds the full command tree, is ~47 ms).

A skill may invoke `home` several times to answer one question, and a shell
script may invoke it in a loop, so this figure is a budget rather than a
statistic. Anything that moves it is a product change.

## No React, no reconciler, no TUI framework

`apps/home` declares five runtime dependencies — `@napi-rs/keyring`,
`@svrooij/sonos`, `citty`, `consola`, `socket.io-client` — and no React. The
whole presentation layer is **200 lines**: `src/core/output.ts` (69),
`src/core/status-view.ts` (64), and `e2e/tui.ts` (67).

> **PLANNED** — [`005-SCHEMA-OUTPUT`](../plans/005-SCHEMA-OUTPUT.md)
>
> `zod` is the sixth runtime dependency, and the only one on the presentation
> path. It is dynamically imported, so it is absent from the graph an invocation
> evaluates unless that invocation resolves a schema.

This is a constraint, not an accident. A retained-mode renderer buys frame
diffing, layout, and redraw, and a process that emits one frame and exits has
no use for any of the three.

Measured, so it does not have to be re-argued: mounting a 20-row Ink view in a
compiled binary costs ~139 ms against the current ~44 ms, `import 'ink'` alone
costs 50–70 ms, and Ink falls back to 80 columns with no controlling terminal —
wrapping a 200-character line into 80/80/40 exactly when a skill is capturing
the output.

## The e2e harness is the one live view, and it is not shipped

`e2e/tui.ts` (67 lines) renders a live progress board while `bun run home:e2e`
runs modules concurrently. It is gated on `process.stdout.isTTY` in
`e2e/run.ts` and falls back to one completion line per module otherwise.

It is a separate entrypoint. `bun run home:build` compiles `src/index.ts`, so
nothing under `e2e/` reaches the shipped binary, and its cost is invisible to
the `home` command.

## Configuration does not come from the environment

Module configuration lives in `~/.config/home/modules/<name>.json` (XDG,
`src/core/paths.ts`), and secrets live in the OS keyring or an encrypted file
backend (`src/core/secrets.ts`). Validation is per-field, declared on
`ConfigField` as `validate` and `probe` in each module's `ModuleManifest`, and
runs interactively during `home <module> configure`.

The CLI reads about a dozen environment variables in total, and none of them
carry module configuration. They are test seams (`XDG_CONFIG_HOME`,
`SONOS_SEED_HOST`), tuning knobs (`HOME_SECRETS_LOCK_TIMEOUT_MS`), and terminal
conventions (`NO_COLOR`, `CI`).

An environment-variable schema validator has nothing to validate here.

## The contract is enforced by tests

> **PLANNED** — [`005-SCHEMA-OUTPUT`](../plans/005-SCHEMA-OUTPUT.md)

`src/__tests__/output.test.ts` pins `emit()` directly: payload on stdout and
diagnostics on stderr, `--json` as one parseable line, the failure shape mapped
to exit codes `1`/`2`/`3`, and no ANSI escape on a non-TTY stdout.

`src/__tests__/output-keys.test.ts` walks every `CommandSpec` in the registry
and asserts that each `out` key resolves to a schema in its module's
`output.ts`. This is the check that stands in for the compile-time link a
returned schema would have provided, so it is not optional.

Schemas are **not** validated against live data at runtime — that would pay
parsing cost on every invocation to catch a class of bug that a fixture test
catches for free, and would turn a formatting mismatch into a failed command.

Until the above lands, `emit()` has no direct test and every guarantee holds by
inspection only. That is the largest known gap in the contract: all seventeen
installed `home-*` skills invoke the CLI in `--json` mode, so a regression in
`emit()` breaks every skill at once and nothing would catch it.
