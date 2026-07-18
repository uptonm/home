# Parallel e2e harness with live TUI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `bun run e2e` run modules concurrently under a semaphore with a live terminal display, cutting wall time from the sum of all modules to roughly the slowest single module.

**Architecture:** The module becomes the unit of work — each module runs its preflight → reads → scenarios strictly in order internally (preserving scenario snapshot/restore isolation), while modules fan out under a global semaphore. A timer-driven ANSI renderer paints one stable row per module from a shared `LiveState`. The final coverage report and all safety rails are unchanged.

**Tech Stack:** TypeScript, Bun. No new dependencies (the TUI is hand-rolled ANSI). Tests via `bun test` / `bun run test`.

## Global Constraints

- **Runtime/tooling:** Bun only — never node/npm/deno. TypeScript only, never `.js`.
- **No new dependencies.** The live display is hand-rolled ANSI escape codes.
- **TUI-only display, no non-TTY fallback** (decision: local-only dev gate; piping is unsupported).
- **Concurrency default K = 8**, tunable via `--concurrency N`.
- **Within a module, reads stay serial**; only modules run concurrently.
- **`e2e/cli.ts` stays the sole spawn choke point** — do not add spawn calls elsewhere; it already refuses `destructive` and unknown paths.
- **Deterministic report:** iterate modules in registry order regardless of completion order.
- **Existing flags preserved:** `--module <name>`, `--dry-run`, `--reads-only`.
- Spec: `docs/superpowers/specs/2026-07-18-parallel-e2e-tui-design.md`.

## File Structure

- `e2e/pool.ts` (new) — generic bounded-concurrency runner. Zero imports.
- `e2e/live.ts` (new) — `LiveState` type + `createLive` factory. Zero imports.
- `e2e/module.ts` (new) — `runModule` (extracted per-module orchestration), `ReadResult`/`ModuleResult` types, `scenarios` list. Imports cli, args, scenario, scenarios/sonos, live.
- `e2e/tui.ts` (new) — `startTui` timer-driven ANSI renderer. Imports live.
- `e2e/run.ts` (rewrite) — orchestrator: parse args, dry-run plan, start TUI, run pool, print report. Imports registry, cli, args, module, live, tui, pool.
- `src/__tests__/e2e-pool.test.ts` (new) — unit test for `pool` (follows the `e2e-guard.test.ts` convention of e2e tests living in `src/__tests__/`).

Reference (do not modify): `e2e/cli.ts`, `e2e/args.ts`, `e2e/scenario.ts`, `e2e/fixtures.ts`, `e2e/scenarios/sonos.ts`.

---

### Task 1: Bounded-concurrency pool

**Files:**
- Create: `e2e/pool.ts`
- Test: `src/__tests__/e2e-pool.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pool<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>` — runs `worker` over every item with at most `limit` concurrent calls; returns results in input order.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/e2e-pool.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { pool } from '../../e2e/pool'

describe('pool', () => {
  test('never exceeds the concurrency limit and preserves input order', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    let inFlight = 0
    let maxInFlight = 0
    const results = await pool(items, 4, async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return n * 2
    })
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(results).toEqual(items.map((n) => n * 2))
  })

  test('empty input resolves to empty results', async () => {
    const results = await pool([], 4, async () => 1)
    expect(results).toEqual([])
  })

  test('a limit larger than the item count still runs each item once', async () => {
    const seen: number[] = []
    const results = await pool([1, 2, 3], 10, async (n) => {
      seen.push(n)
      return n
    })
    expect(seen.slice().sort()).toEqual([1, 2, 3])
    expect(results).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/__tests__/e2e-pool.test.ts`
Expected: FAIL — `Cannot find module '../../e2e/pool'`.

- [ ] **Step 3: Write the minimal implementation**

Create `e2e/pool.ts`:

```ts
/**
 * Run `worker` over every item with at most `limit` calls in flight at once.
 * Results come back in input order regardless of completion order. `limit` is
 * clamped to at least 1; an empty `items` resolves immediately.
 */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const lanes = Math.max(1, Math.min(limit, items.length))
  let next = 0
  async function drain(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => drain()))
  return results
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/__tests__/e2e-pool.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add e2e/pool.ts src/__tests__/e2e-pool.test.ts
git commit -m "feat(e2e): bounded-concurrency pool"
```

---

### Task 2: Live state + module runner, wired sequentially

Extract the per-module body of `run.ts`'s `main()` into a standalone `runModule`, backed by a mutable `LiveState`. After this task the harness behaves exactly as today (sequential, plain text) but the orchestration is a pure function ready to parallelize.

**Files:**
- Create: `e2e/live.ts`
- Create: `e2e/module.ts`
- Modify: `e2e/run.ts` (replace the per-module loop body and `ReadResult`/`buildArgv`/`autoRead` with calls into `module.ts`)

**Interfaces:**
- Consumes: `runCli`, `runStatus`, `commandKey`, `exercised` from `./cli`; `Unresolved`, `argProviders` from `./args`; `runScenario`, `ScenarioResult`, `Scenario` from `./scenario`; `sonosScenarios` from `./scenarios/sonos`.
- Produces:
  - `e2e/live.ts`: `type Phase = 'pending' | 'preflight' | 'reads' | 'scenarios' | 'done' | 'skipped'`; `interface LiveState { module: string; phase: Phase; readsDone: number; readsTotal: number; scenario: string | null; outcome: 'pass' | 'fail' | null; skipReason: string | null }`; `createLive(module: string): LiveState`.
  - `e2e/module.ts`: `interface ReadResult { key: string; outcome: 'pass' | 'fail' | 'unresolved'; detail?: string }`; `interface ModuleResult { module: string; skipped: { reason: string } | null; reads: ReadResult[]; scenarios: ScenarioResult[] }`; `const scenarios: readonly Scenario[]`; `runModule(m, live: LiveState, opts: { readsOnly: boolean }): Promise<ModuleResult>` where `m` is `(typeof import('../src/registry').modules)[number]`.

- [ ] **Step 1: Create `e2e/live.ts`**

```ts
export type Phase = 'pending' | 'preflight' | 'reads' | 'scenarios' | 'done' | 'skipped'

export interface LiveState {
  module: string
  phase: Phase
  readsDone: number
  readsTotal: number
  scenario: string | null
  outcome: 'pass' | 'fail' | null
  skipReason: string | null
}

export function createLive(module: string): LiveState {
  return {
    module,
    phase: 'pending',
    readsDone: 0,
    readsTotal: 0,
    scenario: null,
    outcome: null,
    skipReason: null,
  }
}
```

- [ ] **Step 2: Create `e2e/module.ts`**

Move `ReadResult`, `buildArgv`, and `autoRead` verbatim from `run.ts`, then add `runModule`. Full file:

```ts
import type { ArgSpec, CommandSpec } from '../src/core/types'
import { modules } from '../src/registry'
import { commandKey, runCli, runStatus } from './cli'
import { Unresolved, argProviders } from './args'
import { runScenario, type Scenario, type ScenarioResult } from './scenario'
import { sonosScenarios } from './scenarios/sonos'
import type { LiveState } from './live'

type Module = (typeof modules)[number]

/** Every write scenario the harness knows, across all modules. */
export const scenarios: readonly Scenario[] = [...sonosScenarios]

export interface ReadResult {
  key: string
  outcome: 'pass' | 'fail' | 'unresolved'
  detail?: string
}

export interface ModuleResult {
  module: string
  skipped: { reason: string } | null
  reads: ReadResult[]
  scenarios: ScenarioResult[]
}

function buildArgv(spec: CommandSpec, values: Record<string, string>): string[] {
  const argv: string[] = []
  for (const a of spec.args as ArgSpec[]) {
    const v = values[a.name]
    if (v === undefined) continue
    if (a.kind === 'positional') argv.push(v)
    else if (a.kind === 'boolean') {
      if (v === 'true') argv.push(`--${a.name}`)
    } else argv.push(`--${a.name}`, v)
  }
  return argv
}

async function autoRead(module: string, cmd: CommandSpec): Promise<ReadResult> {
  const key = commandKey(module, cmd.path)
  let values: Record<string, string> = {}
  const provider = argProviders[key]
  const needsArgs = cmd.args.some((a) => a.required)
  if (provider) {
    try {
      values = await provider()
    } catch (err) {
      if (err instanceof Unresolved) return { key, outcome: 'unresolved', detail: err.message }
      throw err
    }
  } else if (needsArgs) {
    return { key, outcome: 'unresolved', detail: 'required args, no provider' }
  }
  const res = await runCli(module, cmd.path, buildArgv(cmd, values))
  if (res.exitCode !== 0) {
    return {
      key,
      outcome: 'fail',
      detail: `exit ${res.exitCode}: ${res.stderr.trim() || res.stdout.trim()}`.slice(0, 300),
    }
  }
  // Exit 0 is not enough: every command runs with --json, so non-JSON stdout
  // means the read regressed even though the process claims success.
  if (res.json === null) {
    return { key, outcome: 'fail', detail: 'exit 0 but stdout was not valid JSON' }
  }
  return { key, outcome: 'pass' }
}

/**
 * Run one module end to end: preflight, then its reads (serial), then its
 * scenarios (serial). Emits progress by mutating `live`; returns structured
 * results. Never writes to the console, so many modules can run at once.
 */
export async function runModule(
  m: Module,
  live: LiveState,
  opts: { readsOnly: boolean },
): Promise<ModuleResult> {
  live.phase = 'preflight'
  const status = await runStatus(m.name)
  if (status.exitCode === 3) {
    live.phase = 'skipped'
    live.skipReason = 'not configured'
    return { module: m.name, skipped: { reason: 'not configured' }, reads: [], scenarios: [] }
  }
  if (status.exitCode !== 0) {
    // 143 = SIGTERM from our own timeout kill.
    const reason = status.exitCode === 143 ? 'status timed out' : `status exited ${status.exitCode}`
    live.phase = 'skipped'
    live.skipReason = reason
    return { module: m.name, skipped: { reason }, reads: [], scenarios: [] }
  }

  const readCmds = m.commands.filter((c) => c.effect === 'read')
  live.readsTotal = readCmds.length
  live.phase = 'reads'
  const reads: ReadResult[] = []
  for (const c of readCmds) {
    reads.push(await autoRead(m.name, c))
    live.readsDone++
  }

  const moduleScenarios = opts.readsOnly ? [] : scenarios.filter((s) => s.module === m.name)
  const scenarioResults: ScenarioResult[] = []
  if (moduleScenarios.length) {
    live.phase = 'scenarios'
    for (const s of moduleScenarios) {
      live.scenario = s.name
      scenarioResults.push(await runScenario(s))
    }
    live.scenario = null
  }

  const failed =
    reads.some((r) => r.outcome === 'fail') || scenarioResults.some((r) => r.outcome === 'fail')
  live.phase = 'done'
  live.outcome = failed ? 'fail' : 'pass'
  return { module: m.name, skipped: null, reads, scenarios: scenarioResults }
}
```

- [ ] **Step 3: Rewrite `e2e/run.ts` to call `runModule` sequentially**

Replace the whole file. This keeps today's behavior (sequential, plain text) but drives it through `runModule`; the TUI arrives in Task 3.

```ts
import { moduleByName, modules } from '../src/registry'
import { commandKey, exercised } from './cli'
import { argProviders } from './args'
import { createLive } from './live'
import { runModule, scenarios, type ModuleResult } from './module'

type Module = (typeof modules)[number]

interface Options {
  dryRun: boolean
  readsOnly: boolean
  moduleFilter: string | null
  concurrency: number
}

/**
 * Strict, fail-closed argv parsing. A typo here must never widen the run: a
 * `--module` with a missing or unknown value would otherwise silently select
 * every module and execute all write scenarios against the house.
 */
function parseArgs(argv: string[]): Options {
  let dryRun = false
  let readsOnly = false
  let moduleFilter: string | null = null
  let concurrency = 8
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--reads-only') readsOnly = true
    else if (arg === '--module') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) {
        console.error('--module requires a module name')
        process.exit(1)
      }
      if (!moduleByName[value]) {
        console.error(`unknown module: ${value}`)
        process.exit(1)
      }
      moduleFilter = value
    } else if (arg === '--concurrency') {
      const value = argv[++i]
      const n = Number(value)
      if (value === undefined || !Number.isInteger(n) || n < 1) {
        console.error('--concurrency requires a positive integer')
        process.exit(1)
      }
      concurrency = n
    } else {
      console.error(`unknown argument: ${arg}`)
      process.exit(1)
    }
  }
  return { dryRun, readsOnly, moduleFilter, concurrency }
}

function printPlan(targets: Module[]): void {
  for (const m of targets) {
    const readCmds = m.commands.filter((c) => c.effect === 'read')
    console.log(`\n${m.name}: ${readCmds.length} auto-reads`)
    for (const c of readCmds) {
      const key = commandKey(m.name, c.path)
      const how = argProviders[key]
        ? 'provider'
        : c.args.some((a) => a.required)
          ? 'UNRESOLVED (no provider)'
          : 'no args'
      console.log(`  ${key}  [${how}]`)
    }
    for (const s of scenarios.filter((s) => s.module === m.name)) console.log(`  scenario: ${s.name}`)
  }
}

function printReport(targets: Module[], results: ModuleResult[]): boolean {
  const allCommands = targets.flatMap((m) => m.commands.map((c) => ({ m: m.name, c })))
  const destructive = allCommands.filter(({ c }) => c.effect === 'destructive')
  const skippedModules = results
    .filter((r) => r.skipped)
    .map((r) => ({ module: r.module, reason: r.skipped!.reason }))
  const skippedNames = new Set(skippedModules.map((s) => s.module))
  const unexercised = allCommands.filter(
    ({ m, c }) => c.effect !== 'destructive' && !skippedNames.has(m) && !exercised.has(commandKey(m, c.path)),
  )
  const reads = results.flatMap((r) => r.reads)
  const scenarioResults = results.flatMap((r) => r.scenarios)
  const failedReads = reads.filter((r) => r.outcome === 'fail')
  const unresolvedReads = reads.filter((r) => r.outcome === 'unresolved')
  const failedScenarios = scenarioResults.filter((r) => r.outcome === 'fail')

  console.log('\n================ e2e report ================')
  console.log(`commands in scope:   ${allCommands.length}`)
  console.log(`exercised:           ${exercised.size}`)
  console.log(`reads pass/fail:     ${reads.filter((r) => r.outcome === 'pass').length}/${failedReads.length}`)
  console.log(`scenarios pass/fail: ${scenarioResults.length - failedScenarios.length}/${failedScenarios.length}`)
  console.log(`skipped modules:     ${skippedModules.map((s) => `${s.module} (${s.reason})`).join(', ') || 'none'}`)
  console.log(`destructive (never run by design): ${destructive.length}`)
  if (unresolvedReads.length) {
    console.log('\nunresolved reads (needs a provider or live data):')
    for (const r of unresolvedReads) console.log(`  - ${r.key}: ${r.detail}`)
  }
  if (unexercised.length) {
    console.log('\nneeds attention (runnable but never exercised):')
    for (const { m, c } of unexercised) console.log(`  - [${c.effect}] ${commandKey(m, c.path)}`)
  }
  const failed = failedReads.length > 0 || failedScenarios.length > 0
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS')
  return failed
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const targets = modules.filter((m) => !opts.moduleFilter || m.name === opts.moduleFilter)

  if (opts.dryRun) {
    printPlan(targets)
    return
  }

  const results: ModuleResult[] = []
  for (const m of targets) {
    const live = createLive(m.name)
    const r = await runModule(m, live, { readsOnly: opts.readsOnly })
    results.push(r)
    const line = r.skipped
      ? `SKIP (${r.skipped.reason})`
      : `${live.outcome?.toUpperCase()} — ${r.reads.filter((x) => x.outcome === 'pass').length}/${r.reads.length} reads`
    console.log(`${m.name.padEnd(14)} ${line}`)
  }

  const failed = printReport(targets, results)
  if (failed) process.exit(1)
}

await main()
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Verify the dry-run plan is unchanged**

Run: `bun run e2e --dry-run`
Expected: the same per-module `N auto-reads` + command list + `scenario:` lines as before (now printed for all modules up front).

- [ ] **Step 6: Verify a scoped live run still works**

Run: `bun run e2e --module graphite`
Expected: a `graphite ...` summary line, then the `e2e report` block ending in `RESULT: PASS` or `RESULT: FAIL` (exact result depends on live state — mechanics are what matter here). No crash, exit reflects RESULT.

- [ ] **Step 7: Confirm the unit suite still passes**

Run: `bun test src/__tests__/e2e-pool.test.ts src/__tests__/e2e-guard.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add e2e/live.ts e2e/module.ts e2e/run.ts
git commit -m "refactor(e2e): extract runModule + LiveState, drive run.ts through it"
```

---

### Task 3: Live TUI renderer, wired sequentially

Add the ANSI renderer and drive the still-sequential run through it, so we see live rows before turning on concurrency.

**Files:**
- Create: `e2e/tui.ts`
- Modify: `e2e/run.ts` (replace the sequential `console.log` summary loop with a TUI-driven loop)

**Interfaces:**
- Consumes: `LiveState` from `./live`.
- Produces: `startTui(states: LiveState[], startedAt: number): { stop: () => void }` — begins a ~100 ms redraw timer over `states` (rendered in array order); `stop()` clears the timer, paints a final frame, and restores the cursor.

- [ ] **Step 1: Create `e2e/tui.ts`**

```ts
import type { LiveState } from './live'

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TICK_MS = 100
const RUNNING: LiveState['phase'][] = ['preflight', 'reads', 'scenarios']

function symbol(s: LiveState, frame: number): string {
  if (s.phase === 'skipped') return '⊘'
  if (s.phase === 'done') return s.outcome === 'fail' ? '✖' : '✔'
  if (s.phase === 'pending') return ' '
  return SPINNER[frame % SPINNER.length]!
}

function activity(s: LiveState): string {
  switch (s.phase) {
    case 'pending':
      return 'queued'
    case 'preflight':
      return 'preflight'
    case 'reads':
      return `reads ${s.readsDone}/${s.readsTotal}`
    case 'scenarios':
      return s.scenario ? `scenario: ${s.scenario}` : 'scenarios'
    case 'skipped':
      return `skipped (${s.skipReason ?? '?'})`
    case 'done':
      return `${s.readsDone}/${s.readsTotal} reads`
  }
}

/**
 * Timer-driven in-place table: one row per module (array order stays stable
 * even as modules finish out of order), plus a footer. TTY-only — repaints by
 * moving the cursor up over the previous block. `stop()` paints one last frame.
 */
export function startTui(states: LiveState[], startedAt: number): { stop: () => void } {
  const width = Math.max(1, ...states.map((s) => s.module.length))
  let frame = 0
  let lastLines = 0

  function render(): void {
    frame++
    const lines = states.map((s) => `  ${symbol(s, frame)} ${s.module.padEnd(width)}  ${activity(s)}`)
    const running = states.filter((s) => RUNNING.includes(s.phase)).length
    const done = states.filter((s) => s.phase === 'done' || s.phase === 'skipped').length
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    lines.push(`  running ${running} · done ${done}/${states.length} · ${elapsed}s`)

    const up = lastLines ? `\x1b[${lastLines}A` : ''
    const body = lines.map((l) => `\x1b[2K${l}`).join('\n')
    process.stdout.write(`${up}${body}\n`)
    lastLines = lines.length
  }

  process.stdout.write('\x1b[?25l') // hide cursor
  render()
  const timer = setInterval(render, TICK_MS)
  return {
    stop() {
      clearInterval(timer)
      render()
      process.stdout.write('\x1b[?25h') // show cursor
    },
  }
}
```

- [ ] **Step 2: Wire the TUI into `run.ts`'s `main()` (still sequential)**

In `e2e/run.ts`, add `import { startTui } from './tui'` to the imports, and replace the `results`/`for` loop in `main()` (everything between building `targets` and the `printReport` call, excluding the dry-run branch) with:

```ts
  const states = targets.map((m) => createLive(m.name))
  const tui = startTui(states, Date.now())
  const results: ModuleResult[] = []
  for (let i = 0; i < targets.length; i++) {
    results.push(await runModule(targets[i]!, states[i]!, { readsOnly: opts.readsOnly }))
  }
  tui.stop()

  const failed = printReport(targets, results)
  if (failed) process.exit(1)
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Verify the live display renders**

Run: `bun run e2e --module graphite`
Expected: a single live row for `graphite` that shows a spinner → `reads x/y` and settles on `✔`/`✖`/`⊘`, a footer line, then the `e2e report` block underneath. The row updates in place (no scrolling spam).

- [ ] **Step 5: Verify dry-run still bypasses the TUI**

Run: `bun run e2e --dry-run`
Expected: plain plan output, no spinner, no cursor hiding.

- [ ] **Step 6: Commit**

```bash
git add e2e/tui.ts e2e/run.ts
git commit -m "feat(e2e): live ANSI TUI renderer"
```

---

### Task 4: Parallelize modules under the semaphore

Swap the sequential loop for the pool. This is the payoff task.

**Files:**
- Modify: `e2e/run.ts` (use `pool`; concurrency already parsed in Task 2)

**Interfaces:**
- Consumes: `pool` from `./pool`; `runModule` from `./module`; `startTui` from `./tui`; `createLive` from `./live`.
- Produces: nothing new.

- [ ] **Step 1: Replace the sequential loop with the pool**

In `e2e/run.ts`, add `import { pool } from './pool'` to the imports, and replace the sequential `for` loop from Task 3 with:

```ts
  const states = targets.map((m) => createLive(m.name))
  const tui = startTui(states, Date.now())
  const results = await pool(targets, opts.concurrency, (m, i) =>
    runModule(m, states[i]!, { readsOnly: opts.readsOnly }),
  )
  tui.stop()

  const failed = printReport(targets, results)
  if (failed) process.exit(1)
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify concurrent execution**

Run: `bun run e2e`
Expected: multiple module rows show spinners simultaneously; the footer's `running` count rises above 1 (up to 8); the run completes noticeably faster than before; the `e2e report` block prints in registry order and the process exits 0 on PASS / 1 on FAIL.

- [ ] **Step 4: Verify the concurrency flag is honored and fail-closed**

Run: `bun run e2e --concurrency 2`
Expected: at most 2 module rows spin at once (footer `running` never exceeds 2).

Run: `bun run e2e --concurrency 0`
Expected: exits 1 with `--concurrency requires a positive integer`.

- [ ] **Step 5: Verify scoped + reads-only paths still work**

Run: `bun run e2e --module sonos --reads-only`
Expected: only the `sonos` row, reads only (no scenario line), report prints.

- [ ] **Step 6: Run the full unit suite**

Run: `bun run test`
Expected: `✓ all N test files passed`.

- [ ] **Step 7: Commit**

```bash
git add e2e/run.ts
git commit -m "feat(e2e): run modules concurrently under a semaphore (default 8)"
```

---

## Notes for the implementer

- **Do not add spawn calls outside `e2e/cli.ts`.** `runModule` reaches the CLI only through `runCli`/`runStatus`, which refuse destructive/unknown paths. This is the safety rail; keep it the single choke point.
- **`exercised`** (in `cli.ts`) is a module-global `Set` populated as a side effect of `runCli`. Concurrent `.add` is safe in single-threaded JS. `printReport` reads `exercised.size` after the pool resolves — do not try to thread it through return values.
- **Determinism:** `printReport` iterates `targets` (registry order) and `results` is returned by `pool` in input order, so output is stable regardless of which module finishes first.
- **`Date.now()`** is fine here — the restriction on it applies only to Workflow scripts, not normal Bun scripts.
- The live network path and the renderer are verified by running the gate (consistent with the harness's existing no-mocks philosophy); only `pool` is unit-tested.
