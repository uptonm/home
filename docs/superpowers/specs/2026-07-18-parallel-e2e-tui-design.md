# Parallel e2e harness with live TUI — design

*2026-07-18. Status: approved, pending implementation.*

## Problem

`bun run e2e` (`e2e/run.ts`) is a manual pre-release gate that exercises the dev
CLI against the real homelab. It spawns `bun src/index.ts <cmd> --json` as a
fresh subprocess for every status preflight and every read, **strictly
sequentially across all ~17 modules**. Total wall time is the *sum* of every
module's work — dozens of `bun` cold starts, each blocked on a live network
round-trip, one at a time. It is too slow to run comfortably, and by design it
will never run in CI (it touches the real house), so there is no reason to keep
CI-friendly append-only output.

The original harness ([`docs/e2e-harness-design.md`](../../e2e-harness-design.md))
locked "strictly sequential execution" deliberately, because write **scenarios**
share one physical house and run `snapshot → mutate → assert → restore`. That
constraint is real but only applies to scenarios (writes). Auto-reads only
observe and dominate the runtime (unifi alone has 52), so they are where the
slowness — and the opportunity — lives.

## Goals

- Cut wall time from *sum of all modules* to *≈ the slowest single module*.
- A live terminal display (TUI) suitable for a local-only dev gate.
- Preserve every existing safety property and the final coverage report.

Non-goals: CI integration, mocking, a non-TTY fallback, parallelizing reads
*within* a module.

## Concurrency model

- **The module is the unit of work.** Each module runs its own
  preflight → auto-reads → scenarios **strictly in order internally**. This
  preserves the snapshot/restore isolation scenarios depend on, and keeps each
  module's results coherent as one unit.
- **Modules fan out** under a single global semaphore, default **K = 8**
  concurrent, tunable with a new `--concurrency N` flag.
- **Reads stay serial within a module.** unifi's 52 reads remain the long pole;
  this is accepted in exchange for a simple one-unit-per-module mental model and
  stable per-module display rows. Wall time becomes `max(module_time)` rather
  than `sum(module_time)`.

### Accepted risk

Different modules' scenarios can now overlap in wall-clock time. Today only
sonos has scenarios; planned ones (unifi, protect) touch disjoint physical
subsystems, so no collision. If two modules ever script the *same* devices, a
per-subsystem lock is added then — not now (YAGNI).

## Components (all under `e2e/`)

1. **`runModule(module, live): Promise<ModuleResult>`** — the current per-module
   body of `main()`, extracted into a pure-ish async function. Does preflight,
   then sequential auto-reads, then sequential scenarios. It **emits progress by
   mutating a `LiveState`** and returns a structured `ModuleResult`
   (preflight outcome, read results, scenario results). It does **no
   `console.log`** — output is data plus live state, which is what makes running
   eight at once safe.

2. **`pool.ts`** — a small semaphore: run an array of async thunks with at most
   K in flight. Gets a unit test asserting max-in-flight never exceeds K and
   every thunk completes.

3. **`tui.ts`** — a timer-driven renderer (~100 ms tick). Holds one `LiveState`
   per module in **registry order** so rows stay stable despite out-of-order
   completion. Each tick moves the cursor up N rows and redraws. A row shows a
   spinner / `✔` / `✖` / `⊘` (skipped), `reads x/y`, and the current scenario
   name; a footer shows `running · done · elapsed`. Pure ANSI escapes, single
   render path, no `isTTY` branch (TUI-only by decision — piping is unsupported).

4. **`run.ts`** — orchestrator. Parses args (unchanged `--module`, `--dry-run`,
   `--reads-only`; new `--concurrency N`), builds the `LiveState[]`, starts the
   TUI, runs the pool over `runModule`, stops the TUI, then prints the
   **existing detailed report** underneath, iterating modules in **registry
   order** for deterministic output. `--dry-run` skips the TUI entirely and
   prints the execution plan exactly as today.

## Data flow

```
run.ts
  parse args → targets (registry order) → LiveState[] (one per module)
  start tui(LiveState[])                 // timer redraws every ~100ms
  pool(targets, K, m => runModule(m, liveFor(m)))
       │  each runModule mutates its LiveState as it progresses
       ▼
  collect ModuleResult[]
  stop tui
  printReport(ModuleResult[] in registry order) → RESULT + exit code
```

`LiveState` is the single shared channel between a running module and the
renderer — no event bus. The renderer only reads; `runModule` only writes its
own module's state.

## What does not change

- **`cli.ts` remains the sole spawn choke point**, still refusing `destructive`
  and unknown command paths. A parallel run cannot restart a switch.
- **The final report** format (commands in scope, exercised n/total, reads
  pass/fail, scenarios pass/fail, skipped modules, unresolved reads, unexercised
  commands, RESULT) is unchanged.
- **Exit-code semantics**: exit 1 on any failed read or scenario.
- **Safety by construction**: within-module ordering is preserved, so scenario
  snapshot/restore isolation holds exactly as before.

## Testing

- Unit test for `pool.ts` (deterministic, no network): concurrency never
  exceeds K; all thunks run; results preserved.
- The live network path and the ANSI renderer are exercised by running the gate
  itself; they are not meaningfully unit-testable and are not mocked (consistent
  with the harness's existing philosophy).
