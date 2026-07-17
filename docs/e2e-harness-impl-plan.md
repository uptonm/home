# E2E Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manual pre-release gate (`bun run e2e`) that runs the dev CLI against the real homelab: auto-runs every read command, runs snapshot/restore scenarios for sonos writes, hard-refuses destructive commands, and prints a coverage report.

**Architecture:** Per the approved spec (`docs/e2e-harness-design.md`): a required `effect: 'read' | 'write' | 'destructive'` field on every `CommandSpec` (enforced by the offline smoke test), plus a plain Bun runner under `e2e/` (not `bun:test`) whose single spawn choke point (`e2e/cli.ts`) refuses destructive/unknown commands.

**Tech Stack:** Bun ≥ 1.3, TypeScript strict, no new dependencies.

## Global Constraints

- TypeScript only; Bun for everything (run, test). No new npm dependencies.
- `bun test` must stay fully offline — nothing under `src/__tests__/` may spawn the CLI against the network. E2E code lives in `e2e/` and only its pure logic gets unit-tested.
- The harness always passes `--json` and asserts on exit codes: 0 ok, 1 user, 2 system, 3 not-configured (from `src/core/output.ts`).
- Designated Sonos test target: **Living Room** (secondary for grouping: **Bathroom**). No scenario may target another speaker.
- Execution is strictly sequential; never parallelize spawned commands.
- All work happens in a worktree on branch `feat/e2e-harness`; ends as a PR against `main`.

---

### Task 0: Worktree + spec commit

**Files:**
- Create: worktree at `~/Projects/home-e2e` (branch `feat/e2e-harness` off `main`)
- Commit: `docs/e2e-harness-design.md`, `docs/e2e-harness-impl-plan.md` (currently untracked in the main checkout)

- [ ] **Step 1: Create the worktree**

```bash
cd ~/Projects/home
git fetch origin
git worktree add ~/Projects/home-e2e -b feat/e2e-harness origin/main
cp docs/e2e-harness-design.md docs/e2e-harness-impl-plan.md ~/Projects/home-e2e/docs/
cd ~/Projects/home-e2e && bun install
```

- [ ] **Step 2: Sanity-check the dev CLI works from the worktree against prod config**

Run: `cd ~/Projects/home-e2e && bun src/index.ts sonos players list --json`
Expected: JSON array including `"name":"Living Room"`.

- [ ] **Step 3: Commit the docs**

```bash
git add docs/e2e-harness-design.md docs/e2e-harness-impl-plan.md
git commit -m "docs: add e2e harness design + implementation plan"
```

---

### Task 1: `effect` field + classification of every command

**Files:**
- Modify: `src/core/types.ts` (CommandSpec)
- Modify: `src/__tests__/smoke.test.ts`
- Modify: every command file under `src/modules/*/commands/` (~80 files)

**Interfaces:**
- Produces: `CommandSpec.effect: 'read' | 'write' | 'destructive'` (required) — consumed by `e2e/cli.ts` (Task 2) and the runner's coverage report (Task 4).

- [ ] **Step 1: Write the failing test** — add to the `every command is well-formed` loop in `src/__tests__/smoke.test.ts`:

```ts
test('every command declares an effect', () => {
  for (const cmd of m.commands as CommandSpec[]) {
    expect(['read', 'write', 'destructive']).toContain(cmd.effect)
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test smoke`
Expected: FAIL (effect is `undefined` everywhere). Typecheck also fails after Step 3 until classification completes — that is the enforcement working.

- [ ] **Step 3: Add the field to `CommandSpec`** in `src/core/types.ts`, after `description`:

```ts
/**
 * What running this command does to the world. `read` observes only;
 * `write` mutates state that is recoverable or acceptable to perturb;
 * `destructive` is irreversible or outward-facing without a containable
 * target — the e2e harness refuses to execute it.
 */
effect: 'read' | 'write' | 'destructive'
```

- [ ] **Step 4: Classify every command.** Add `effect: '<value>',` immediately after `path:` in each `CommandSpec` literal. Everything is `read` **except** the following:

| Module | `write` | `destructive` |
|---|---|---|
| unifi | `vouchers create` | `devices restart`, `devices poe-cycle`, `client` (block/reconnect real clients), `clients authorize-guest` (no CLI reverse), `vouchers delete` |
| protect | `cameras ptz`, `cameras led`, `lights on`, `lights off`, `lights toggle` | `cameras talkback` |
| assistant | `state set`, `light`, `switch`, `climate`, `scene`, `script`, `service call`, `automation trigger` | — |
| spotify | — | — |
| sonos | `play`, `pause`, `next`, `prev`, `volume set`, `mute`, `groups join`, `groups leave`, `groups party`, `groups ungroup`, `queue clear`, `queue add`, `queue remove`, `queue save`, `play-uri`, `favorites play`, `play-mode set`, `sleep-timer set`, `eq set`, `group-volume set`, `group-mute`, `seek`, `playlists play`, `line-in`, `notify` | `alarms enable`, `alarms disable` (wake alarms) |
| tts | — (`synth` is `read`: writes a local MP3 tempfile, touches no homelab state) | — |
| gdrive | — | `auth login` (interactive), `auth logout` (revokes token) |
| gmail | — | `auth login` |
| discord | `send-message` | — |

Notes: `camera snapshot` / `protect snapshot` / `gdrive files download|export` are `read` — they write local files only.

- [ ] **Step 5: Verify green**

Run: `bun run typecheck && bun test`
Expected: both PASS. Typecheck passing proves no command literal was missed (the field is required).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: require effect classification on every CommandSpec"
```

---

### Task 2: `e2e/cli.ts` — the spawn choke point

**Files:**
- Create: `e2e/cli.ts`
- Test: `src/__tests__/e2e-guard.test.ts` (offline — exercises only the refusal paths, which throw before any spawn)

**Interfaces:**
- Consumes: `modules`, `moduleByName` from `src/registry.ts`; `CommandSpec.effect` from Task 1.
- Produces (used by Tasks 3–5):
  - `runCli(module: string, path: string[], args?: string[], opts?: { timeoutMs?: number }): Promise<CliResult>`
  - `runStatus(module: string): Promise<CliResult>`
  - `findCommand(module: string, path: string[]): CommandSpec | null`
  - `commandKey(module: string, path: string[]): string`, `exercised: Set<string>`, `class RefusedError`
  - `interface CliResult { exitCode: number; stdout: string; stderr: string; json: unknown }`

- [ ] **Step 1: Write the failing tests** — `src/__tests__/e2e-guard.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { RefusedError, findCommand, runCli } from '../../e2e/cli'

describe('e2e spawn guard', () => {
  test('findCommand resolves a real command', () => {
    expect(findCommand('sonos', ['volume', 'get'])?.effect).toBe('read')
  })
  test('unknown command is refused before spawn', () => {
    expect(runCli('sonos', ['no', 'such'])).rejects.toThrow(RefusedError)
  })
  test('unknown module is refused before spawn', () => {
    expect(runCli('nope', ['list'])).rejects.toThrow(RefusedError)
  })
  test('destructive command is refused before spawn', () => {
    expect(runCli('unifi', ['devices', 'restart'], ['aa:bb'])).rejects.toThrow(RefusedError)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test e2e-guard`
Expected: FAIL — cannot resolve `../../e2e/cli`.

- [ ] **Step 3: Implement `e2e/cli.ts`**

```ts
import { join } from 'node:path'
import { moduleByName } from '../src/registry'
import type { CommandSpec } from '../src/core/types'

const REPO_ROOT = join(import.meta.dir, '..')

export class RefusedError extends Error {}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
  json: unknown
}

export const exercised = new Set<string>()

export function commandKey(module: string, path: string[]): string {
  return [module, ...path].join(' ')
}

export function findCommand(module: string, path: string[]): CommandSpec | null {
  const m = moduleByName[module]
  if (!m) return null
  const want = path.join(' ')
  return m.commands.find((c) => c.path.join(' ') === want) ?? null
}

async function spawnHome(argv: string[], timeoutMs: number): Promise<CliResult> {
  const proc = Bun.spawn(['bun', 'src/index.ts', ...argv, '--json'], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const exitCode = await proc.exited
  clearTimeout(timer)
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  let json: unknown = null
  try {
    json = JSON.parse(stdout)
  } catch {
    /* non-JSON output stays null; callers assert on exitCode first */
  }
  return { exitCode, stdout, stderr, json }
}

export async function runCli(
  module: string,
  path: string[],
  args: string[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<CliResult> {
  const cmd = findCommand(module, path)
  if (!cmd) throw new RefusedError(`unknown command: ${commandKey(module, path)}`)
  if (cmd.effect === 'destructive') {
    throw new RefusedError(`destructive command refused: ${commandKey(module, path)}`)
  }
  exercised.add(commandKey(module, path))
  return spawnHome([module, ...path, ...args], opts.timeoutMs ?? 30_000)
}

export async function runStatus(module: string): Promise<CliResult> {
  if (!moduleByName[module]) throw new RefusedError(`unknown module: ${module}`)
  return spawnHome([module, 'status'], 30_000)
}
```

- [ ] **Step 4: Verify green**

Run: `bun test e2e-guard && bun run typecheck`
Expected: PASS. (Note: only refusal paths are unit-tested; the happy path spawns and is covered by live runs in Tasks 4–6.)

- [ ] **Step 5: Commit**

```bash
git add e2e/cli.ts src/__tests__/e2e-guard.test.ts
git commit -m "feat(e2e): spawn choke point that refuses destructive commands"
```

---

### Task 3: fixtures + read-arg providers

**Files:**
- Create: `e2e/fixtures.ts`
- Create: `e2e/args.ts`

**Interfaces:**
- Consumes: `runCli` from `e2e/cli.ts`.
- Produces (used by Task 4):
  - `fixtures: { sonosRoom: string; sonosSecondRoom: string }`
  - `argProviders: Record<string, Provider>` keyed by `commandKey` (e.g. `'unifi devices get'`), where `type Provider = () => Promise<Record<string, string>>`
  - `class Unresolved extends Error` — thrown by a provider when live data can't supply a value (e.g. empty list); the runner reports it as a skip-with-reason.

- [ ] **Step 1: `e2e/fixtures.ts`**

```ts
/** Designated real-world test targets. Scenarios must take targets from here. */
export const fixtures = {
  sonosRoom: 'Living Room',
  sonosSecondRoom: 'Bathroom',
} as const
```

- [ ] **Step 2: Inspect live output shapes needed for chaining.** Run each of these and note the array item fields (authoritative over any guess below):

```bash
cd ~/Projects/home-e2e
bun src/index.ts unifi devices list --json | head -c 600
bun src/index.ts unifi settings list --json | head -c 300
bun src/index.ts protect cameras list --json | head -c 400
bun src/index.ts assistant states list --json | head -c 400
bun src/index.ts spotify search "daft punk" --json | head -c 600
bun src/index.ts sonos playlists list --json | head -c 300
bun src/index.ts sonos library browse --help
```

- [ ] **Step 3: Implement `e2e/args.ts`.** Core shape (adjust field names strictly per Step 2 findings):

```ts
import { runCli } from './cli'
import { fixtures } from './fixtures'

export class Unresolved extends Error {}

export type Provider = () => Promise<Record<string, string>>

const listCache = new Map<string, unknown[]>()

async function rows(module: string, path: string[], args: string[] = []): Promise<unknown[]> {
  const key = [module, ...path, ...args].join(' ')
  const hit = listCache.get(key)
  if (hit) return hit
  const res = await runCli(module, path, args)
  if (res.exitCode !== 0) throw new Unresolved(`${key} exited ${res.exitCode}`)
  const data = Array.isArray(res.json) ? res.json : null
  if (!data) throw new Unresolved(`${key} did not return an array`)
  listCache.set(key, data)
  return data
}

function firstField(module: string, listPath: string[], field: string, argName: string): Provider {
  return async () => {
    const first = (await rows(module, listPath))[0] as Record<string, unknown> | undefined
    const v = first?.[field]
    if (v === undefined || v === null || v === '') {
      throw new Unresolved(`${[module, ...listPath].join(' ')}: no ${field} on first row`)
    }
    return { [argName]: String(v) }
  }
}

const fixed = (values: Record<string, string>): Provider => async () => values

export const argProviders: Record<string, Provider> = {
  // unifi — get/stats chained off their list siblings
  'unifi devices get': firstField('unifi', ['devices', 'list'], 'mac', 'mac'),
  'unifi devices stats': firstField('unifi', ['devices', 'list'], 'mac', 'ref'),
  'unifi clients get': firstField('unifi', ['clients', 'list'], 'mac', 'mac'),
  'unifi dpi-stats client': firstField('unifi', ['clients', 'list'], 'mac', 'mac'),
  'unifi vouchers get': firstField('unifi', ['vouchers', 'list'], 'id', 'id'),
  'unifi networks get': firstField('unifi', ['networks', 'list'], 'name', 'name'),
  'unifi reservations get': firstField('unifi', ['reservations', 'list'], 'name', 'ref'),
  'unifi wlans get': firstField('unifi', ['wlans', 'list'], 'ssid', 'ssid'),
  'unifi port-forwards get': firstField('unifi', ['port-forwards', 'list'], 'name', 'name'),
  'unifi firewall get': firstField('unifi', ['firewall', 'list'], 'id', 'id'),
  'unifi firewall-groups get': firstField('unifi', ['firewall-groups', 'list'], 'name', 'name'),
  'unifi port-profiles get': firstField('unifi', ['port-profiles', 'list'], 'name', 'name'),
  'unifi wlan-groups get': firstField('unifi', ['wlan-groups', 'list'], 'name', 'name'),
  'unifi user-groups get': firstField('unifi', ['user-groups', 'list'], 'name', 'name'),
  'unifi radius-profiles get': firstField('unifi', ['radius-profiles', 'list'], 'name', 'name'),
  'unifi radius-accounts get': firstField('unifi', ['radius-accounts', 'list'], 'name', 'name'),
  'unifi routes get': firstField('unifi', ['routes', 'list'], 'name', 'name'),
  'unifi dpi-apps get': firstField('unifi', ['dpi-apps', 'list'], 'name', 'name'),
  'unifi dpi-groups get': firstField('unifi', ['dpi-groups', 'list'], 'name', 'name'),
  'unifi tags get': firstField('unifi', ['tags', 'list'], 'name', 'name'),
  'unifi settings get': firstField('unifi', ['settings', 'list'], 'key', 'key'),
  // protect
  'protect cameras get': firstField('protect', ['cameras', 'list'], 'id', 'id'),
  'protect events get': firstField('protect', ['events', 'list'], 'id', 'id'),
  'protect lights get': firstField('protect', ['lights', 'list'], 'id', 'ref'),
  'protect sensors get': firstField('protect', ['sensors', 'list'], 'id', 'ref'),
  'protect doorlocks get': firstField('protect', ['doorlocks', 'list'], 'id', 'ref'),
  'protect chimes get': firstField('protect', ['chimes', 'list'], 'id', 'ref'),
  'protect viewers get': firstField('protect', ['viewers', 'list'], 'id', 'ref'),
  'protect bridges get': firstField('protect', ['bridges', 'list'], 'id', 'ref'),
  'protect liveviews get': firstField('protect', ['liveviews', 'list'], 'id', 'ref'),
  'protect users get': firstField('protect', ['users', 'list'], 'id', 'ref'),
  'protect groups get': firstField('protect', ['groups', 'list'], 'id', 'ref'),
  'protect snapshot': firstField('protect', ['cameras', 'list'], 'name', 'camera'),
  // assistant
  'assistant states search': fixed({ query: 'light' }),
  'assistant state get': firstField('assistant', ['states', 'list'], 'entity_id', 'entity'),
  'assistant history get': firstField('assistant', ['states', 'list'], 'entity_id', 'entity'),
  'assistant calendars get': firstField('assistant', ['calendars', 'list'], 'entity_id', 'entity'),
  'assistant template': fixed({ template: '{{ now() }}' }),
  'assistant camera snapshot': fixed({}), // resolved in Step 4 below
  // spotify — refs chained from search (field per Step 2 findings)
  'spotify search': fixed({ query: 'daft punk' }),
  // sonos
  'sonos players get': fixed({ room: fixtures.sonosRoom }),
  'sonos groups get': fixed({ room: fixtures.sonosRoom }),
  'sonos volume get': fixed({ room: fixtures.sonosRoom }),
  'sonos queue list': fixed({ room: fixtures.sonosRoom }),
  'sonos playlists get': firstField('sonos', ['playlists', 'list'], 'name', 'name'),
  'sonos alarms get': firstField('sonos', ['alarms', 'list'], 'id', 'id'),
  // sonos library browse: use the first category from `--help` (Step 2)
  // tts
  'tts synth': fixed({ text: 'e2e harness test' }),
  // gmail/gdrive/discord: modules are skipped at preflight while unconfigured;
  // trivial chains included so they light up once configured
  'gmail messages get': firstField('gmail', ['messages', 'list'], 'id', 'id'),
  'gmail threads get': firstField('gmail', ['threads', 'list'], 'id', 'id'),
  'gmail labels get': firstField('gmail', ['labels', 'list'], 'id', 'id'),
  'gmail drafts get': firstField('gmail', ['drafts', 'list'], 'id', 'id'),
  'gdrive files get': firstField('gdrive', ['files', 'list'], 'id', 'file'),
  'discord get-messages': fixed({}), // needs a designated channel fixture — add when configured
}
```

- [ ] **Step 4: Fill the gaps found in Step 2.** Concretely: the spotify ref chains (`track get`, `album get`, `artist get`, `playlist get`, `album tracks`, `artist albums`, `artist top-tracks`, `playlist tracks`, `categories get` via `categories list`), the sonos `library browse`/`library search` category value, and `assistant camera snapshot` (pick a `camera.*` entity from `states list`, else delete the provider so it reports as unresolved). `spotify playlist get`/`playlist tracks` may be unresolvable from search — if so, leave without provider; the report will say so honestly.

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
Expected: PASS.

```bash
git add e2e/fixtures.ts e2e/args.ts
git commit -m "feat(e2e): fixtures and read-arg providers"
```

---

### Task 4: runner — preflight, auto-reads, report, flags

**Files:**
- Create: `e2e/scenario.ts` (scenario types + engine)
- Create: `e2e/run.ts` (entry point)
- Modify: `package.json` (add `"e2e": "bun e2e/run.ts"` to scripts)

**Interfaces:**
- Consumes: everything produced by Tasks 2–3.
- Produces (used by Task 5):
  - `interface Scenario { name: string; module: string; run(ctx: ScenarioCtx): Promise<void> }`
  - `interface ScenarioCtx { cli: typeof runCli; fixtures: typeof fixtures; check(cond: boolean, msg: string): void; defer(fn: () => Promise<void>): void }` — `defer` pushes restore steps run LIFO in a `finally`.

- [ ] **Step 1: `e2e/scenario.ts`**

```ts
import { runCli } from './cli'
import { fixtures } from './fixtures'

export interface ScenarioCtx {
  cli: typeof runCli
  fixtures: typeof fixtures
  check(cond: boolean, msg: string): void
  defer(fn: () => Promise<void>): void
}

export interface Scenario {
  name: string
  module: string
  run(ctx: ScenarioCtx): Promise<void>
}

export interface ScenarioResult {
  name: string
  module: string
  outcome: 'pass' | 'fail'
  detail?: string
}

export async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const restores: Array<() => Promise<void>> = []
  const ctx: ScenarioCtx = {
    cli: runCli,
    fixtures,
    check(cond, msg) {
      if (!cond) throw new Error(msg)
    },
    defer(fn) {
      restores.push(fn)
    },
  }
  let failure: string | undefined
  try {
    await s.run(ctx)
  } catch (err) {
    failure = (err as Error).message
  } finally {
    for (const restore of restores.reverse()) {
      try {
        await restore()
      } catch (err) {
        failure = failure ?? `restore failed: ${(err as Error).message}`
      }
    }
  }
  return failure
    ? { name: s.name, module: s.module, outcome: 'fail', detail: failure }
    : { name: s.name, module: s.module, outcome: 'pass' }
}
```

- [ ] **Step 2: `e2e/run.ts`**

```ts
import { modules } from '../src/registry'
import type { ArgSpec, CommandSpec } from '../src/core/types'
import { commandKey, exercised, runCli, runStatus } from './cli'
import { Unresolved, argProviders } from './args'
import { runScenario, type Scenario, type ScenarioResult } from './scenario'
import { sonosScenarios } from './scenarios/sonos'

interface ReadResult {
  key: string
  outcome: 'pass' | 'fail' | 'unresolved'
  detail?: string
}

const allScenarios: Scenario[] = [...sonosScenarios]

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
    return { key, outcome: 'fail', detail: `exit ${res.exitCode}: ${res.stderr.trim() || res.stdout.trim()}`.slice(0, 300) }
  }
  return { key, outcome: 'pass' }
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const readsOnly = argv.includes('--reads-only')
  const moduleFilter = argv.includes('--module') ? argv[argv.indexOf('--module') + 1] : null

  const targets = modules.filter((m) => !moduleFilter || m.name === moduleFilter)
  if (moduleFilter && targets.length === 0) {
    console.error(`unknown module: ${moduleFilter}`)
    process.exit(1)
  }

  const skippedModules: Array<{ module: string; reason: string }> = []
  const reads: ReadResult[] = []
  const scenarioResults: ScenarioResult[] = []

  for (const m of targets) {
    const readCmds = m.commands.filter((c) => c.effect === 'read')
    const moduleScenarios = readsOnly ? [] : allScenarios.filter((s) => s.module === m.name)

    if (dryRun) {
      console.log(`\n${m.name}: ${readCmds.length} auto-reads`)
      for (const c of readCmds) {
        const key = commandKey(m.name, c.path)
        const how = argProviders[key] ? 'provider' : c.args.some((a) => a.required) ? 'UNRESOLVED (no provider)' : 'no args'
        console.log(`  ${key}  [${how}]`)
      }
      for (const s of moduleScenarios) console.log(`  scenario: ${s.name}`)
      continue
    }

    console.log(`\n== ${m.name}: preflight`)
    const status = await runStatus(m.name)
    if (status.exitCode === 3) {
      skippedModules.push({ module: m.name, reason: 'not configured' })
      console.log(`   SKIP (not configured)`)
      continue
    }
    if (status.exitCode !== 0) {
      skippedModules.push({ module: m.name, reason: `status exited ${status.exitCode}` })
      console.log(`   SKIP (status exited ${status.exitCode})`)
      continue
    }

    console.log(`== ${m.name}: ${readCmds.length} auto-reads`)
    for (const c of readCmds) {
      const r = await autoRead(m.name, c)
      reads.push(r)
      console.log(`   ${r.outcome.toUpperCase().padEnd(10)} ${r.key}${r.detail ? ` — ${r.detail}` : ''}`)
    }

    for (const s of moduleScenarios) {
      console.log(`== ${m.name}: scenario ${s.name}`)
      const r = await runScenario(s)
      scenarioResults.push(r)
      console.log(`   ${r.outcome.toUpperCase()} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    }
  }

  if (dryRun) return

  // ---- report ----
  const allCommands = targets.flatMap((m) => m.commands.map((c) => ({ m: m.name, c })))
  const destructive = allCommands.filter(({ c }) => c.effect === 'destructive')
  const skippedNames = new Set(skippedModules.map((s) => s.module))
  const unexercised = allCommands.filter(
    ({ m, c }) => c.effect !== 'destructive' && !skippedNames.has(m) && !exercised.has(commandKey(m, c.path)),
  )
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
  if (failedReads.length || failedScenarios.length) {
    console.log('\nRESULT: FAIL')
    process.exit(1)
  }
  console.log('\nRESULT: PASS')
}

await main()
```

- [ ] **Step 3: Create a placeholder-free empty scenario module so run.ts compiles before Task 5** — `e2e/scenarios/sonos.ts`:

```ts
import type { Scenario } from '../scenario'

export const sonosScenarios: Scenario[] = []
```

- [ ] **Step 4: Add the script to `package.json`** — in `"scripts"`: `"e2e": "bun e2e/run.ts"`.

- [ ] **Step 5: Verify dry-run (spawns nothing)**

Run: `bun run e2e -- --dry-run`
Expected: per-module listing of auto-reads with `[provider]` / `[no args]` / `[UNRESOLVED]` markers; no network traffic.

- [ ] **Step 6: Verify reads live, one module at a time, then all**

Run: `bun run e2e -- --module unifi --reads-only`, then `--module protect`, `--module assistant`, `--module spotify`, `--module sonos`, `--module tts`, then `bun run e2e -- --reads-only`.
Expected: gmail/gdrive/discord SKIP (not configured); everything else passes or is listed as unresolved with a reason. Iterate on `e2e/args.ts` field names until failures are zero and unresolved entries are only genuinely unprovidable ones. `bun run typecheck && bun test` still PASS.

- [ ] **Step 7: Commit**

```bash
git add e2e/ package.json
git commit -m "feat(e2e): runner with preflight, auto-reads, and coverage report"
```

---

### Task 5: sonos write scenarios

**Files:**
- Modify: `e2e/scenarios/sonos.ts`

**Interfaces:**
- Consumes: `Scenario`/`ScenarioCtx` from `e2e/scenario.ts`; `fixtures.sonosRoom` = Living Room, `fixtures.sonosSecondRoom` = Bathroom.
- Covers writes: `volume set`, `mute`, `play-mode set`, `eq set`, `group-volume set`, `play`, `pause`, `groups join`, `groups leave`, `notify` (plus `tts synth` read).

- [ ] **Step 1: Implement the scenarios** (field names like `volume`/`shuffle`/`bass` verified against live `get` output during Task 3 — adjust if they differ):

```ts
import type { Scenario, ScenarioCtx } from '../scenario'

const room = (ctx: ScenarioCtx) => ctx.fixtures.sonosRoom

function field(json: unknown, key: string): unknown {
  return (json as Record<string, unknown> | null)?.[key]
}

export const sonosScenarios: Scenario[] = [
  {
    name: 'volume-round-trip',
    module: 'sonos',
    async run(ctx) {
      const before = await ctx.cli('sonos', ['volume', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'volume get failed')
      const original = Number(field(before.json, 'volume'))
      ctx.check(Number.isFinite(original), 'volume get returned no volume')
      ctx.defer(async () => {
        await ctx.cli('sonos', ['volume', 'set'], [room(ctx), String(original)])
      })
      const target = original === 17 ? 18 : 17
      const set = await ctx.cli('sonos', ['volume', 'set'], [room(ctx), String(target)])
      ctx.check(set.exitCode === 0, 'volume set failed')
      const after = await ctx.cli('sonos', ['volume', 'get'], [room(ctx)])
      ctx.check(Number(field(after.json, 'volume')) === target, `expected volume ${target}`)
    },
  },
  {
    name: 'mute-cycle',
    module: 'sonos',
    async run(ctx) {
      // ends unmuted; acceptable perturbation on the test speaker
      const on = await ctx.cli('sonos', ['mute'], [room(ctx), '--state', 'on'])
      ctx.check(on.exitCode === 0, 'mute on failed')
      const off = await ctx.cli('sonos', ['mute'], [room(ctx), '--state', 'off'])
      ctx.check(off.exitCode === 0, 'mute off failed')
    },
  },
  {
    name: 'play-mode-round-trip',
    module: 'sonos',
    async run(ctx) {
      const before = await ctx.cli('sonos', ['play-mode', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'play-mode get failed')
      const shuffle = String(field(before.json, 'shuffle'))
      const original = shuffle === 'true' || shuffle === 'on' ? 'on' : 'off'
      ctx.defer(async () => {
        await ctx.cli('sonos', ['play-mode', 'set'], [room(ctx), '--shuffle', original])
      })
      const flipped = original === 'on' ? 'off' : 'on'
      const set = await ctx.cli('sonos', ['play-mode', 'set'], [room(ctx), '--shuffle', flipped])
      ctx.check(set.exitCode === 0, 'play-mode set failed')
      const after = await ctx.cli('sonos', ['play-mode', 'get'], [room(ctx)])
      const now = String(field(after.json, 'shuffle'))
      ctx.check((now === 'true' || now === 'on') === (flipped === 'on'), `expected shuffle ${flipped}`)
    },
  },
  {
    name: 'eq-bass-round-trip',
    module: 'sonos',
    async run(ctx) {
      const before = await ctx.cli('sonos', ['eq', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'eq get failed')
      const original = Number(field(before.json, 'bass'))
      ctx.check(Number.isFinite(original), 'eq get returned no bass')
      ctx.defer(async () => {
        await ctx.cli('sonos', ['eq', 'set'], [room(ctx), '--bass', String(original)])
      })
      const target = original >= 10 ? original - 1 : original + 1
      const set = await ctx.cli('sonos', ['eq', 'set'], [room(ctx), '--bass', String(target)])
      ctx.check(set.exitCode === 0, 'eq set failed')
      const after = await ctx.cli('sonos', ['eq', 'get'], [room(ctx)])
      ctx.check(Number(field(after.json, 'bass')) === target, `expected bass ${target}`)
    },
  },
  {
    name: 'group-volume-round-trip',
    module: 'sonos',
    async run(ctx) {
      const before = await ctx.cli('sonos', ['group-volume', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'group-volume get failed')
      const original = Number(field(before.json, 'volume'))
      ctx.check(Number.isFinite(original), 'group-volume get returned no volume')
      ctx.defer(async () => {
        await ctx.cli('sonos', ['group-volume', 'set'], [room(ctx), String(original)])
      })
      const target = original === 15 ? 16 : 15
      const set = await ctx.cli('sonos', ['group-volume', 'set'], [room(ctx), String(target)])
      ctx.check(set.exitCode === 0, 'group-volume set failed')
    },
  },
  {
    name: 'pause-play-round-trip',
    module: 'sonos',
    async run(ctx) {
      const np = await ctx.cli('sonos', ['now-playing'], [room(ctx)])
      ctx.check(np.exitCode === 0, 'now-playing failed')
      const state = String(field(np.json, 'state') ?? field(np.json, 'transportState') ?? '')
      if (!/playing/i.test(state)) return // nothing playing: pause/play covered only when safe to restore
      const pause = await ctx.cli('sonos', ['pause'], [room(ctx)])
      ctx.check(pause.exitCode === 0, 'pause failed')
      const play = await ctx.cli('sonos', ['play'], [room(ctx)])
      ctx.check(play.exitCode === 0, 'play (restore) failed')
    },
  },
  {
    name: 'group-join-leave',
    module: 'sonos',
    async run(ctx) {
      // join test speaker to the second room's group, then leave — ends solo either way
      ctx.defer(async () => {
        await ctx.cli('sonos', ['groups', 'leave'], [room(ctx)])
      })
      const join = await ctx.cli('sonos', ['groups', 'join'], [room(ctx), ctx.fixtures.sonosSecondRoom])
      ctx.check(join.exitCode === 0, 'groups join failed')
      const leave = await ctx.cli('sonos', ['groups', 'leave'], [room(ctx)])
      ctx.check(leave.exitCode === 0, 'groups leave failed')
    },
  },
  {
    name: 'tts-notify',
    module: 'sonos',
    async run(ctx) {
      const synth = await ctx.cli('tts', ['synth'], ['e2e harness test'])
      ctx.check(synth.exitCode === 0, 'tts synth failed')
      const file = String(field(synth.json, 'path') ?? '')
      ctx.check(file.length > 0, 'tts synth returned no path')
      const notify = await ctx.cli(
        'sonos',
        ['notify'],
        [room(ctx), '--file', file, '--delete-after'],
        { timeoutMs: 60_000 },
      )
      ctx.check(notify.exitCode === 0, 'notify failed')
    },
  },
]
```

- [ ] **Step 2: Verify live** (full-suite runs are authorized; Living Room will audibly play a short TTS clip)

Run: `bun run e2e -- --module sonos` (twice — the second run confirms restores left state consistent)
Expected: all scenarios PASS both times; report shows sonos writes covered.

- [ ] **Step 3: Full suite**

Run: `bun run e2e`
Expected: RESULT: PASS; gmail/gdrive/discord skipped; needs-attention list contains only writes we deliberately left uncovered (unifi `vouchers create`, protect writes, assistant writes, remaining sonos writes: `next`, `prev`, `queue *`, `play-uri`, `favorites play`, `sleep-timer set`, `group-mute`, `seek`, `playlists play`, `line-in`, `groups party`, `groups ungroup`).

- [ ] **Step 4: Commit**

```bash
git add e2e/scenarios/sonos.ts
git commit -m "feat(e2e): sonos write scenarios with snapshot/restore"
```

---

### Task 6: docs + final verification + PR

**Files:**
- Modify: `README.md` (short "E2E harness" section: what it is, `bun run e2e` flags, safety model)
- Modify: `docs/e2e-harness-design.md` (status line → implemented; note any deviations discovered during implementation, e.g. providers that stayed unresolved)

- [ ] **Step 1: Write the README section** — cover: run `bun run e2e` before `build:install`; flags `--module <name>`, `--reads-only`, `--dry-run`; `effect` classification is mandatory on new commands (smoke test enforces); destructive commands are refused by `e2e/cli.ts`; test targets live in `e2e/fixtures.ts`.

- [ ] **Step 2: Final verification**

Run: `bun run typecheck && bun test && bun run e2e -- --dry-run && bun run e2e`
Expected: all PASS. `bun test` completes with no network access.

- [ ] **Step 3: Commit + push + PR**

```bash
git add -A && git commit -m "docs: e2e harness usage"
git push -u origin feat/e2e-harness
gh pr create --title "E2E test harness: effect classification + live runner" --body "<summary per repo conventions>"
```

Expected: PR URL printed. Leave the worktree in place until the PR merges.
