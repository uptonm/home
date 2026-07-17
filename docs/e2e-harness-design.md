# E2E test harness — design

*2026-07-17. Status: approved design, not yet implemented.*

A manual pre-release gate — `bun run e2e` — that exercises the dev CLI
(`bun src/index.ts`) against the real homelab and reports what works, what
broke, and what wasn't covered. Run it before `build:install`.

**Non-goals:** mocking, CI integration, parallel execution, and interactive
commands (`configure`, `init`, `secrets`) — all out of scope.

## Decisions locked during design

- **Write scope:** everything except destructive. Reads run automatically;
  writes run via hand-written reversible scenarios, including ones that
  visibly perturb the house (lights, playback).
- **Outward-facing commands** (discord `send-message`, gmail drafts,
  assistant `notify`, tts on speakers) run only against designated test
  targets declared in `e2e/fixtures.ts` — a test Discord channel, a specific
  speaker, drafts-only for gmail (never send).
- **Cadence:** manual pre-release gate. No hook into `build:install`, no
  scheduling.
- **Dev-vs-prod config is a non-hurdle:** `src/core/paths.ts` resolves config
  from `$XDG_CONFIG_HOME/home` and secrets from the `home-cli` keyring
  service, identically for `bun src/index.ts` and the compiled binary.
  `@napi-rs/keyring` loads from `node_modules`. Only requirement: spawn from
  the repo root.

## 1. Command classification

Every `CommandSpec` gains one required field:

```ts
effect: 'read' | 'write' | 'destructive'
```

- `read` — observes state only (`list`, `get`, `stats`, `now-playing`,
  `camera snapshot`).
- `write` — mutates state but is recoverable or acceptable to perturb:
  volume, lights, playback, queue, eq, assistant `state set`, discord
  `send-message` (test target), gmail draft creation.
- `destructive` — the harness never runs it: `devices restart`,
  `devices poe-cycle`, `vouchers delete`, `cameras talkback`, gmail send,
  `alarms disable`, anything irreversible or outward-facing without a
  containable target.

`src/__tests__/smoke.test.ts` enforces that every command declares an effect,
so a new command cannot enter the registry unclassified.

*Follow-up (explicitly not in scope):* render `effect` into generated
SKILL.md files so agents know which commands mutate.

## 2. Layout

```
e2e/
  run.ts          entry point → package.json "e2e": "bun e2e/run.ts"
  cli.ts          spawn helper — the single choke point (see §4)
  fixtures.ts     designated real-world targets: test speaker, known camera,
                  a UniFi device MAC, test Discord channel id, …
  scenarios/
    sonos.ts      per-module write scenarios
    unifi.ts
    …
```

Deliberately **not** `bun:test` files: `bun test` stays fully offline and can
never touch the homelab; a plain runner also gives strict sequential ordering
(scenarios share one physical house) and a custom coverage report.

## 3. Runner behavior — three phases

1. **Preflight.** Per module: config exists and `status` succeeds. Exit
   code 3 (`not_configured`) → module reported SKIPPED, not failed. Covers
   gmail/gdrive/discord being unconfigured today.
2. **Auto-reads.** Enumerate every `read` command from the registry and run
   it for real. Args resolve from `fixtures.ts` or by chaining (run
   `cameras list`, feed the first id into `cameras get`). Reads whose args
   can't be satisfied are *reported*, never silently skipped.
3. **Scenarios.** Hand-written ordered flows per module covering `write`
   commands, always shaped **snapshot → mutate → assert → restore**, with
   restore in a `finally` so a failed assertion still puts the house back.

**Assertions are structural invariants, not golden files** — live data
changes. Assert: exit code 0, stdout parses as JSON (`--json` always passed),
expected shape (e.g. `cameras list` is a non-empty array), and round-trips in
scenarios (`volume set 23` → `volume get` returns 23). Exit-code taxonomy
from `src/core/output.ts`: 0 ok, 1 user, 2 system, 3 config.

**Report.** Per-module pass/fail/skip table plus coverage: exercised n/190,
uncovered-by-design (destructive), and uncovered-needs-attention (write
command with no scenario, read command with unresolvable args). The last
bucket is what keeps the suite honest as modules grow.

**Flags.** `--module <name>` to scope, `--dry-run` to print the execution
plan without spawning anything, `--reads-only` for a lower-impact run.

## 4. Safety rails

- `e2e/cli.ts` is the only way harness code spawns the CLI. It resolves the
  requested path against the registry and hard-refuses `destructive` and
  unknown paths. A scenario physically cannot restart a switch, even by typo.
- Outward-facing writes take targets from `fixtures.ts` only.
- Strictly sequential execution.
- Module commands never write `~/.config/home` (only `configure`/`init`/
  `secrets` do, and those are outside the enumerated surface), so running
  against production config is write-safe by construction.

## 5. Rollout

1. `effect` field on `CommandSpec` + classification of all 190 commands +
   smoke-test enforcement.
2. Runner: preflight + auto-reads + report.
3. Scenarios for sonos and unifi (largest surface, cleanest
   snapshot/restore shapes).
4. Scenarios for protect, assistant, spotify, tts.
5. gmail/gdrive/discord fixtures once those modules are configured.
