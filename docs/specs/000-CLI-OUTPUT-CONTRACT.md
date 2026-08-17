---
plans: [000-KEEP-PLAIN-OUTPUT]
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

The separation is structural, not a convention someone remembers to follow:
`run` has no access to a stdout writer, and `emit` has no access to the module
that produced the data.

`src/core/citty.ts` builds every command tree, and constructs the per-command
consola instance with both `stdout` and `stderr` pointed at `process.stderr`.
Logging therefore cannot reach stdout even by accident. `src/core/configure.ts`
writes its interactive prompts to stderr for the same reason.

## Human formatting

`formatHuman` in `src/core/output.ts` is the whole of the default renderer:

- a string passes through unchanged
- an array of objects becomes **tab-separated values** with a header row
- anything else becomes `JSON.stringify(data, null, 2)`

TSV is a deliberate choice, not a placeholder. It is the format that survives
`cut -f2`, `awk -F'\t'`, and `sort -k1`, and it is the reason human output is
still useful in a pipe. Column alignment would make the same rows prettier on a
terminal and unparseable everywhere else.

Nothing wraps. Piped `home --help` emits 28 lines longer than 80 columns, the
longest 247 characters, and every one of them arrives intact.

`src/core/status-view.ts` is the one hand-written view, used by `home status`.
It renders the readiness board as an aligned column of module rows, and takes
`color` as an explicit argument rather than detecting anything itself.

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

This is a constraint, not an accident. A retained-mode renderer buys frame
diffing, layout, and redraw, and a process that emits one frame and exits has
no use for any of the three. The evaluation that established this, and the
libraries it turned down, are recorded in
[`000-KEEP-PLAIN-OUTPUT`](../plans/000-KEEP-PLAIN-OUTPUT.md).

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

> **NEEDS APPROVAL** — [`000-KEEP-PLAIN-OUTPUT`](../plans/000-KEEP-PLAIN-OUTPUT.md)

`src/__tests__/output.test.ts` pins the three guarantees directly against
`emit()`: that the payload lands on stdout and diagnostics on stderr, that
`--json` produces one parseable line, that the failure shape maps to exit codes
`1`/`2`/`3`, and that no ANSI escape reaches a non-TTY stdout.

Until then `emit()` — the function every command's output passes through — has
no direct test, and the guarantees above hold by inspection only.
