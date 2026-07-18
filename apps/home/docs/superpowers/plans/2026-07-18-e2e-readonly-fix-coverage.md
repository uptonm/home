# E2E Readonly Fix & Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make `bun e2e/run.ts --reads-only` pass from any checkout (including untracked worktree branches) with zero failed reads, and close every closable coverage gap so all 144+ read commands are exercised or honestly unresolved.

**Architecture:** Three layers of fixes, ordered so each layer's verification tooling exists before it's needed: (A) harness diagnostics and classification (the report currently hides failure details — fix that first so later tasks can be verified from output), (B) one core-CLI adapter bug + module code bugs (spotify, unifi, assistant), (C) e2e arg providers and fixtures for every unresolved read. Sources: 10 parallel module audits performed 2026-07-18; every field name below was verified against the module's actual output-mapping code, and file:line references are against main @ 38b8892.

**Tech Stack:** TypeScript, Bun ≥ 1.3, citty, Biome.

## Global Constraints

- **NEVER run raw `bun test`** — it wiped real secrets on Jul 17. Always `bun run test` (hermetic wrapper). Same for typecheck: `bun run typecheck`.
- The e2e suite hits **live home services**. During development run module-scoped: `bun e2e/run.ts --reads-only --module <name>`. Full runs sparingly.
- All e2e runs in this plan are `--reads-only`. No write scenarios, no `gt` mutations, no Discord sends.
- TypeScript only, no `.js` files. Biome for lint/format.
- Any change to a module's commands, flags, or docs ends with `bun run build:install && home skill install` (skill regen rule). Tasks that need it say so; pure e2e/ changes don't.
- Conventional commits (`fix(e2e): …`, `feat(unifi): …`) matching repo history.
- The graphite module self-limits on untracked branches — that is expected; the plan makes the harness classify it correctly rather than "fixing" gt.

## Current failure inventory (baseline, 2026-07-18)

18 failing reads: unifi 5 (`devices stats`, `tags list`, `events list`, `alarms list`, `sessions list`), spotify 7 (all container get/children), github 1 (`repos get`), assistant 1 (`calendars list`), graphite 4 (untracked-branch, worktree only). 49 unresolved reads, of which ~29 are closable by providers in this plan.

---

## Phase A — Harness diagnostics & classification (e2e/ only)

### Task 1: Print failed reads and scenarios in the report

**Files:**
- Modify: `e2e/run.ts:102` (after the unresolved block in `printReport`)

**Interfaces:**
- Consumes: `failedReads`/`failedScenarios` already computed at `e2e/run.ts:88-90`; `ReadResult.detail` is always set on fail (`e2e/module.ts:60,66`) and pre-truncated to 300 chars.
- Produces: report sections `failed reads:` and `failed scenarios:` that every later task uses for verification.

- [x] **Step 1: Add the two sections**

```ts
  if (failedReads.length) {
    console.log('\nfailed reads:')
    for (const r of failedReads) console.log(`  - ${r.key}: ${r.detail}`)
  }
  if (failedScenarios.length) {
    console.log('\nfailed scenarios:')
    for (const r of failedScenarios) console.log(`  - ${r.name}: ${r.detail}`)
  }
```

(Check `ScenarioResult`'s shape in `e2e/scenario.ts` — use `r.name`/`r.detail` as defined there.)

- [x] **Step 2: Verify against a known-failing module**

Run: `bun e2e/run.ts --reads-only --module github 2>&1 | tail -15`
Expected: a `failed reads:` section containing `github repos get: exit 1: … Missing required positional argument: REPO` (this failure still exists until Task 7).

- [x] **Step 3: Commit**

```bash
git add e2e/run.ts
git commit -m "fix(e2e): print failed read/scenario details in the report"
```

### Task 2: Gate the TUI on TTY, plain fallback otherwise

**Files:**
- Modify: `e2e/run.ts` (main, ~line 122), `e2e/tui.ts` (export `activity`), `docs/superpowers/specs/2026-07-18-parallel-e2e-tui-design.md:29` (amend the "Non-goals … non-TTY fallback" line — this reverses that decision).

**Interfaces:**
- Consumes: `startTui(states, startedAt)` and `activity(s: LiveState)` from `e2e/tui.ts`; `LiveState` from `e2e/live.ts`.
- Produces: piped/CI output free of ANSI codes; one plain completion line per module.

- [x] **Step 1: Export `activity` from tui.ts** (currently module-private) and add the gate in `main()`:

```ts
  const tty = process.stdout.isTTY === true
  const tui = tty ? startTui(states, Date.now()) : { stop() {} }
  let results: ModuleResult[]
  try {
    results = await pool(targets, opts.concurrency, async (m, i) => {
      const r = await runModule(m, states[i]!, { readsOnly: opts.readsOnly })
      if (!tty) console.log(`${states[i]!.phase === 'skipped' ? '⊘' : states[i]!.outcome === 'fail' ? '✖' : '✔'} ${m.name}  ${activity(states[i]!)}`)
      return r
    })
  } finally {
    tui.stop()
  }
```

- [x] **Step 2: Verify no ANSI when piped**

Run: `bun e2e/run.ts --reads-only --module sonos 2>&1 | cat -v | grep -c '\^\['`
Expected: `0`. And one `✔ sonos  20/20 reads`-style line appears. Interactive run (no pipe) still shows the spinner table.

- [x] **Step 3: Amend the design doc non-goal line** to note the fallback was added (one sentence, dated).

- [x] **Step 4: Commit**

```bash
git add e2e/run.ts e2e/tui.ts docs/superpowers/specs/2026-07-18-parallel-e2e-tui-design.md
git commit -m "fix(e2e): plain non-TTY output instead of raw ANSI frames"
```

### Task 3: Harden child-process lifecycle (SIGKILL escalation + timeout detail)

**Files:**
- Modify: `e2e/cli.ts:36` (spawnHome timer), `e2e/module.ts` (autoRead fail branch)
- Test: `src/__tests__/e2e-cli.test.ts` (create)

**Interfaces:**
- Consumes: `spawnHome` internals in `e2e/cli.ts:29-48`.
- Produces: no pool lane can wedge forever; timeout fails read `read timed out (SIGTERM)` instead of `exit 143: `.

- [x] **Step 1: Write the failing test** — a child that traps SIGTERM must still die:

```ts
import { expect, test } from 'bun:test'

test('spawn timeout escalates to SIGKILL', async () => {
  const proc = Bun.spawn(['bun', '-e', 'process.on("SIGTERM",()=>{});setTimeout(()=>{},1e9)'], { stdout: 'ignore', stderr: 'ignore' })
  const t1 = setTimeout(() => proc.kill(), 100)
  const t2 = setTimeout(() => proc.kill('SIGKILL'), 600)
  const code = await proc.exited
  clearTimeout(t1); clearTimeout(t2)
  expect(code).not.toBe(0)
}, 5000)
```

(This pins the escalation pattern; then apply the same shape inside `spawnHome`: keep the existing `timeoutMs` SIGTERM timer, add a `timeoutMs + 5_000` SIGKILL timer, clear both after `proc.exited`.)

- [x] **Step 2: Run it** — `bun run test src/__tests__/e2e-cli.test.ts` → PASS (the test passes by construction; its value is documenting the pattern — the real change is in spawnHome).

- [x] **Step 3: Apply escalation in `spawnHome`** and, in `autoRead`'s fail branch (`e2e/module.ts:56-62`), special-case 143: `detail: 'read timed out (SIGTERM after 30s)'`.

- [x] **Step 4: Verify** — `bun run typecheck` clean; `bun e2e/run.ts --reads-only --module tts` still passes (0 reads, exercises preflight path).

- [x] **Step 5: Commit**

```bash
git add e2e/cli.ts e2e/module.ts src/__tests__/e2e-cli.test.ts
git commit -m "fix(e2e): SIGKILL escalation and explicit timeout detail"
```

### Task 4: Contain per-module worker crashes

**Files:**
- Modify: `e2e/run.ts` (pool callback from Task 2)

**Interfaces:**
- Consumes: `pool` rejects the whole `Promise.all` if any worker throws (`e2e/pool.ts:20`); `autoRead` rethrows non-`Unresolved` provider errors (`e2e/module.ts:51`).
- Produces: a thrown provider bug becomes one failed read on that module; the run completes and the report prints.

- [x] **Step 1: Wrap the worker body**

```ts
    results = await pool(targets, opts.concurrency, async (m, i) => {
      try {
        const r = await runModule(m, states[i]!, { readsOnly: opts.readsOnly })
        if (!tty) console.log(/* Task 2 line */)
        return r
      } catch (err) {
        states[i]!.phase = 'done'
        states[i]!.outcome = 'fail'
        return { module: m.name, skipped: null, reads: [{ key: m.name, outcome: 'fail' as const, detail: `harness error: ${err}`.slice(0, 300) }], scenarios: [] }
      }
    })
```

(Match `ModuleResult`'s exact shape from `e2e/module.ts` — adjust field names to what it declares.)

- [x] **Step 2: Verify by temporary fault injection** — add `throw new Error('boom')` at the top of a provider (e.g. `'sonos players get'`), run `bun e2e/run.ts --reads-only --module sonos`, expect the run to complete with `failed reads: - sonos: harness error: Error: boom` and other modules unaffected in a full dry check. Remove the injection.

- [x] **Step 3: Commit**

```bash
git add e2e/run.ts
git commit -m "fix(e2e): contain worker crashes to one module result"
```

### Task 5: `firstField` upgrades — non-empty row scan, honest empty-list message, listArgs

**Files:**
- Modify: `e2e/args.ts:28-37`
- Test: `src/__tests__/e2e-args.test.ts` (create)

**Interfaces:**
- Produces (later tasks depend on these exact signatures):
  - `firstField(module: string, listPath: string[], field: string, argName: string, listArgs?: string[]): Provider` — now scans for the **first row with a non-empty `field`** (fixes unifi `port-profiles get`, where an unnamed profile sorts to row 0), throws `Unresolved('<key>: list empty')` on `[]`, `Unresolved('<key>: no <field> on any row')` otherwise, and forwards `listArgs` to `rows()` (which already accepts args and includes them in the cache key).
  - `pickField(rows: unknown[], field: string): string | null` — extracted pure helper for unit testing.

- [x] **Step 1: Write failing tests**

```ts
import { expect, test } from 'bun:test'
import { pickField } from '../../e2e/args'

test('pickField skips rows with empty field', () => {
  expect(pickField([{ name: '' }, { name: 'LAN' }], 'name')).toBe('LAN')
})
test('pickField null on empty list', () => {
  expect(pickField([], 'name')).toBeNull()
})
test('pickField null when field absent everywhere', () => {
  expect(pickField([{ id: 1 }], 'name')).toBeNull()
})
```

- [x] **Step 2: Run** — `bun run test src/__tests__/e2e-args.test.ts` → FAIL (`pickField` not exported).

- [x] **Step 3: Implement**

```ts
export function pickField(rowsIn: unknown[], field: string): string | null {
  for (const r of rowsIn) {
    const v = (r as Record<string, unknown> | null)?.[field]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return null
}

function firstField(module: string, listPath: string[], field: string, argName: string, listArgs: string[] = []): Provider {
  return async () => {
    const all = await rows(module, listPath, listArgs)
    if (all.length === 0) throw new Unresolved(`${[module, ...listPath].join(' ')}: list empty`)
    const v = pickField(all, field)
    if (v === null) throw new Unresolved(`${[module, ...listPath].join(' ')}: no ${field} on any row`)
    return { [argName]: v }
  }
}
```

- [x] **Step 4: Run tests + typecheck** — `bun run test src/__tests__/e2e-args.test.ts` PASS, `bun run typecheck` clean.

- [x] **Step 5: Live spot-check** — `bun e2e/run.ts --reads-only --module unifi 2>&1 | tail -30`: `port-profiles get` moves from unresolved to **pass**; empties now read `list empty`.

- [x] **Step 6: Commit**

```bash
git add e2e/args.ts src/__tests__/e2e-args.test.ts
git commit -m "fix(e2e): firstField scans for first usable row, honest messages, listArgs"
```

### Task 6: `firstFieldIn` (wrapped lists) + environmental-code classification

**Files:**
- Modify: `e2e/args.ts` (new helper beside `firstField`), `e2e/module.ts` (autoRead fail branch)
- Test: extend `src/__tests__/e2e-args.test.ts`

**Interfaces:**
- Produces:
  - `firstFieldIn(module: string, listPath: string[], itemsKey: string, field: string, argName: string): Provider` — for list commands that wrap rows (`{messages:[...]}`, `{issues:[...]}`, `{items:[...]}`, `{monitors:[...]}`). **Explicit key, not auto-detect**: linear's `withWarnings` can add a sibling `warnings` array, which would make single-array auto-detection flake.
  - autoRead: when `exitCode !== 0` and stdout parsed as `{ok:false, code}` with the code in `environmentalCodes[module]`, classify **unresolved** (not fail). Initial allowlist: `graphite: ['graphite_untracked_branch']`.

- [x] **Step 1: Tests** (reuse `pickField`; test the unwrap logic via an exported pure helper):

```ts
import { unwrapItems } from '../../e2e/args'

test('unwrapItems pulls named array', () => {
  expect(unwrapItems({ messages: [{ id: 'm1' }], resultSizeEstimate: 5 }, 'messages')).toEqual([{ id: 'm1' }])
})
test('unwrapItems null when key missing (empty mailbox drops it)', () => {
  expect(unwrapItems({ resultSizeEstimate: 0 }, 'messages')).toBeNull()
})
```

- [x] **Step 2: Run to fail**, then implement:

```ts
export function unwrapItems(data: unknown, itemsKey: string): unknown[] | null {
  const items = (data as Record<string, unknown> | null)?.[itemsKey]
  return Array.isArray(items) ? items : null
}

function firstFieldIn(module: string, listPath: string[], itemsKey: string, field: string, argName: string): Provider {
  return async () => {
    const key = [module, ...listPath].join(' ')
    const items = unwrapItems(await cachedJson(module, listPath), itemsKey)
    if (!items || items.length === 0) throw new Unresolved(`${key}: no ${itemsKey}[] rows`)
    const v = pickField(items, field)
    if (v === null) throw new Unresolved(`${key}: no ${field} on any ${itemsKey} row`)
    return { [argName]: v }
  }
}
```

- [x] **Step 3: Environmental codes in `e2e/module.ts`** — at the top of autoRead's `exitCode !== 0` branch:

```ts
const environmentalCodes: Record<string, ReadonlySet<string>> = {
  graphite: new Set(['graphite_untracked_branch']),
}
// in autoRead:
    const body = res.json as { ok?: unknown; code?: unknown; message?: unknown } | null
    if (body?.ok === false && typeof body.code === 'string' && environmentalCodes[module]?.has(body.code)) {
      return { key, outcome: 'unresolved', detail: `environmental ${body.code}: ${body.message ?? ''}`.slice(0, 300) }
    }
```

- [x] **Step 4: Verify** — tests pass; `bun e2e/run.ts --reads-only --module graphite` from this worktree: the 4 untracked-branch reads become unresolved, module **passes** (graphite reaches full green in Task 15).

- [x] **Step 5: Commit**

```bash
git add e2e/args.ts e2e/module.ts src/__tests__/e2e-args.test.ts
git commit -m "feat(e2e): wrapped-list provider helper and environmental-code classification"
```

---

## Phase B — Core CLI fix

### Task 7: Optional positionals must stay optional through citty

**Files:**
- Modify: `src/core/citty.ts:17-30` (`argsToCitty`)
- Test: `src/__tests__/citty-args.test.ts` (create)

**Interfaces:**
- Consumes: `ArgSpec` (`src/core/types.ts:3-10`, `required?: boolean` — semantically defaults to false).
- Produces: positionals without explicit `required` become `required: false` in the citty ArgsDef. Blast radius audited 2026-07-18: exactly **one** spec in the repo omits `required` on a positional (`github repos get` `repo`, `src/modules/github/commands/repos.ts:12`), and its `run()` already handles undefined via `optionalString` → `resolveRepoFlag` fallback. All other positionals declare `required` explicitly. Zero behavior change elsewhere.

- [x] **Step 1: Failing test**

```ts
import { expect, test } from 'bun:test'
import { argsToCitty } from '../core/citty'

test('positional without required maps to required:false', () => {
  const def = argsToCitty([{ name: 'repo', kind: 'positional', description: 'x' }])
  expect((def.repo as { required?: boolean }).required).toBe(false)
})
test('explicit required survives', () => {
  const def = argsToCitty([{ name: 'room', kind: 'positional', description: 'x', required: true }])
  expect((def.room as { required?: boolean }).required).toBe(true)
})
```

(Export `argsToCitty` — it's currently module-private.)

- [x] **Step 2: Run to fail**, then fix line 24:

```ts
    if (a.kind === 'positional') spec.required = a.required ?? false
    else if (a.required !== undefined) spec.required = a.required
```

- [x] **Step 3: Verify** — `bun run test src/__tests__/citty-args.test.ts` PASS; live: `bun src/index.ts github repos get --json` now emits repo JSON (falls back to cwd inference) with exit 0; `bun e2e/run.ts --reads-only --module github` shows `repos get` **pass** (remaining github unresolved close in Task 15).

- [x] **Step 4: Commit**

```bash
git add src/core/citty.ts src/__tests__/citty-args.test.ts
git commit -m "fix(core): optional positionals no longer inherit citty's implicit required"
```

---

## Phase C — Module code fixes

### Task 8: Spotify — canonical `id` on search matches, provider chains on it

**Files:**
- Modify: `src/modules/spotify/client.ts` (types :28,:59,:71,:82; mappers :264-301 and :525-570; search doc comment :20-27), `src/__tests__/spotify-client.test.ts`, `e2e/args.ts:40-49` (`spotifyRef`), `e2e/args.ts:106` (`categories get` → `firstFieldIn`).
- Skill regen required at the end (doc comment/output shape change).

**Interfaces:**
- Consumes: `withResolvedTrack` (client.ts:406-417) spreads `...match`, so an added `id` survives the playable-uri rewrite untouched. `resolveRef`/`extractSpotifyRef` (client.ts:629-636) accept bare 22-char ids.
- Produces: `TrackMatch`/`AlbumMatch`/`ArtistMatch`/`PlaylistMatch` gain `id: string`; `spotifyRef(type)` returns `{ ref: <type>s[0].id }`.
- Why: search deliberately rewrites container uris to `spotify:track:<first-track>` for Sonos; the canonical container reference is currently **destroyed** on successful resolution — neither e2e nor any real caller can reach `album get`/`album tracks`/`artist albums`/`playlist tracks` from search output. Browse commands can't substitute: only `new-releases` emits canonical refs, and only for albums. Sonos never imports the match types (consumes uri strings), so this is purely additive.

- [x] **Step 1: Failing tests** — in `src/__tests__/spotify-client.test.ts`, extend the existing normalize/shape expectations so every match object asserts `id` (e.g. album fixture with `id: '0dEIca2nhcxDUV8C5QkPYb'` expects `id` echoed on the match). Run `bun run test src/__tests__/spotify-client.test.ts` → FAIL.

- [x] **Step 2: Implement** — add `id: string` to the four match interfaces; populate `id: t.id` / `id: a.id` / `id: p.id` in all eight mappers (four in `normalizeSearchResponse`, four `shape*` fns). Mention `id` in the search doc comment (client.ts:20-27).

- [x] **Step 3: Update `spotifyRef`**

```ts
function spotifyRef(type: 'tracks' | 'albums' | 'artists' | 'playlists'): Provider {
  return async () => {
    const data = (await cachedJson('spotify', ['search'], ['daft punk'])) as Record<string, unknown>
    const items = data[type]
    const first = Array.isArray(items) ? (items[0] as Record<string, unknown> | undefined) : undefined
    const id = first?.id
    if (!id) throw new Unresolved(`spotify search: no ${type}[0].id`)
    return { ref: String(id) }
  }
}
```

And `'spotify categories get': firstFieldIn('spotify', ['categories', 'list'], 'items', 'id', 'id')` (categories list emits `Paged` `{items,...}`, client.ts:613-617; rows verified live as `{kind,id,name}`).

- [x] **Step 4: Verify** — `bun run test` PASS; `bun e2e/run.ts --reads-only --module spotify` → **12/12 reads pass, 0 unresolved**.

- [x] **Step 5: Skill regen + commit**

```bash
bun run build:install && home skill install
git add src/modules/spotify/client.ts src/__tests__/spotify-client.test.ts e2e/args.ts
git commit -m "feat(spotify): carry canonical id through search matches"
```

### Task 9: UniFi — shared MAC→integration-id resolver (fixes stats + 3 latent write paths)

**Files:**
- Modify: `src/modules/unifi/integration-client.ts` (new resolver; delete the false comment at :266-268), `src/modules/unifi/commands/devices.ts:43-53` (stats), `src/modules/unifi/commands/devices.ts:83-90` (restart), `src/modules/unifi/commands/poe-cycle.ts:71` (integration fallback), `src/modules/unifi/commands/client-control.ts:103-128` (authorize-guest — clients have the same UUID-vs-Mongo split; use `integrationListClients` if present, else leave a targeted fix).
- Test: `src/__tests__/unifi-integration.test.ts` (create or extend existing unifi tests).

**Interfaces:**
- Consumes: `integrationListDevices` (`integration-client.ts:118-121`), paginated; integration device rows carry `id` (UUID) and `macAddress` (verified live on 10.4.57: `/devices` rows `{id: 'c77d9f3f-…', macAddress: '0c:ea:14:63:09:55', …}` and `/devices/{uuid}/statistics/latest` → 200).
- Produces: `resolveIntegrationDeviceId(cfg: UnifiConfig, mac: string): Promise<string | null>` — normalizes MAC (lowercase, colons), scans integration device pages, returns the UUID or null. All four call sites use it instead of private `_id`.

- [x] **Step 1: Failing test** — unit-test the matching logic with a mocked page (follow the existing unifi test file's mocking pattern; if none mocks HTTP, extract pure `matchDeviceByMac(rows, mac)` and test that):

```ts
import { expect, test } from 'bun:test'
import { matchDeviceByMac } from '../modules/unifi/integration-client'

test('matches case-insensitively on macAddress', () => {
  const rows = [{ id: 'uuid-1', macAddress: '1C:0B:8B:6E:BA:39' }]
  expect(matchDeviceByMac(rows, '1c:0b:8b:6e:ba:39')).toBe('uuid-1')
})
test('null when absent', () => {
  expect(matchDeviceByMac([], 'aa:bb:cc:dd:ee:ff')).toBeNull()
})
```

- [x] **Step 2: Run to fail, implement** — `matchDeviceByMac` pure + `resolveIntegrationDeviceId` calling `integrationListDevices` and delegating; rewrite `devices stats`:

```ts
    const deviceId = await resolveIntegrationDeviceId(cfg, ref)
    if (!deviceId) return { ok: false, kind: 'user', message: `no device matching ${JSON.stringify(ref)}`, code: 'not_found' }
    const stats = await integrationGetDeviceStats(cfg, deviceId)
    if (!stats) return { ok: false, kind: 'user', message: `stats not available for ${ref}`, code: 'not_found' }
```

Swap the same resolver into restart/poe-cycle; for authorize-guest apply the analogous client-side resolver against the integration clients list. Delete the `integration-client.ts:266-268` comment claiming `_id` parity.

- [x] **Step 3: Verify** — `bun run test` PASS; live: `bun src/index.ts unifi devices stats 0c:ea:14:63:09:55 --json` returns stats (was `not_found`); `--module unifi` e2e: `devices stats` **pass**. Do NOT live-test restart/poe-cycle/authorize-guest (writes) — typecheck + unit coverage only.

- [x] **Step 4: Commit**

```bash
git add src/modules/unifi/integration-client.ts src/modules/unifi/commands/devices.ts src/modules/unifi/commands/poe-cycle.ts src/modules/unifi/commands/client-control.ts src/__tests__/unifi-integration.test.ts
git commit -m "fix(unifi): resolve integration API ids by MAC instead of assuming private _id parity"
```

### Task 10: UniFi — `integrationAppInfo` field name

**Files:**
- Modify: `src/modules/unifi/integration-client.ts:45-56`

- [x] **Step 1: Fix** — `/info` on 10.4.57 returns `{"applicationVersion":"10.4.57"}`, not `server_version`:

```ts
    const body = await requestJson<{ applicationVersion?: string; server_version?: string; uuid?: string }>(…)
    const version = body.applicationVersion ?? body.server_version
    return version ? { version, uuid: body.uuid ?? '' } : null
```

- [x] **Step 2: Verify** — `bun src/index.ts unifi status --json` → `"integration":{"version":"10.4.57"}` (was `null`).

- [x] **Step 3: Commit** — `git commit -am "fix(unifi): read applicationVersion from integration /info"`

### Task 11: Assistant — empty calendars instead of HTTP 404

**Files:**
- Modify: `src/modules/assistant/client.ts:263-265` (`listCalendars`)

**Interfaces:**
- Consumes: the module's existing 404-tolerant pattern in `getState` (`client.ts:61-72`) — use `request` and special-case 404 before throwing. HA 404s `/api/calendars` when no calendar integration is loaded; an empty list is the accurate answer.
- Produces: `calendars list` → `[]` (pass); `calendars get` degrades to honest unresolved (`list empty`) until a calendar integration exists.

- [x] **Step 1: Implement** (mirror getState's shape):

```ts
export async function listCalendars(cfg: AssistantConfig): Promise<HassCalendar[]> {
  const res = await request(`${cfg.url}/api/calendars`, { headers: authHeaders(cfg) })
  // HA returns 404 here when no calendar integration is loaded — that means
  // "no calendars", not an error.
  if (res.status === 404) return []
  if (!res.ok) throw new SystemError(`HTTP ${res.status} from ${cfg.url}/api/calendars`, `http_${res.status}`)
  return (await res.json()) as HassCalendar[]
}
```

(Adapt to `request`'s actual signature in `src/core/http.ts` and the error idiom `requestJson` uses.)

- [x] **Step 2: Verify** — `bun src/index.ts assistant calendars list --json` → `[]`, exit 0; `--module assistant` e2e → 11 pass / 0 fail / 1 unresolved (`calendars get: … list empty`).

- [x] **Step 3: Commit** — `git commit -am "fix(assistant): treat missing calendar integration as empty list"`

### Task 12: UniFi — retire `tags` and `sessions` (endpoints removed upstream)

**Files:**
- Delete: `src/modules/unifi/commands/tags.ts`
- Modify: `src/modules/unifi/commands/operational.ts:89-103` (remove `sessionsList`), `src/modules/unifi/client.ts` (drop `listTags` :333-340 and the sessions fetch :402-415), `src/modules/unifi/index.ts` (unregister), `e2e/args.ts:74` (drop tags providers)

**Interfaces:**
- Why: Network 10.4.57 removed `rest/tag` (400 InvalidObject) and `stat/sessions` (404). No Integration-API or v2 equivalent exists for either; `clients all` (`stat/alluser`, passing) already covers connection history. Retirement, not migration.

- [x] **Step 1: Remove commands, client fns, registry entries, providers.** `grep -rn "tags\|sessions" src/modules/unifi/ e2e/` afterward to catch strays.
- [x] **Step 2: Verify** — `bun run typecheck` + `bun run test` clean; `--module unifi` e2e: `tags list`/`tags get`/`sessions list` gone from every report section.
- [x] **Step 3: Skill regen + commit**

```bash
bun run build:install && home skill install
git add -A
git commit -m "feat(unifi)!: retire tags and sessions commands removed by Network 10.x"
```

### Task 13: UniFi — migrate `events`/`alarms list` to the v2 system-log

**Files:**
- Modify: `src/modules/unifi/client.ts` (new v2 helper; remap `:360-382`), `src/modules/unifi/commands/operational.ts:30-61`
- Skill regen required.

**Interfaces:**
- Target: `POST {url}/proxy/network/v2/api/site/<site>/system-log/all` with `{pageNumber, pageSize}` body, `X-API-KEY` header — **undocumented/private; shape must be confirmed before implementing** (Step 1). Alarms are a category filter on the same endpoint (`system-log/critical` or a `categories` body filter). Fallback if the probe disproves the endpoint: retire both exactly like Task 12.

- [x] **Step 1: Probe (read-only)** — one-off script against the live controller using the module's stored config; confirm URL, body, and response row fields (`timestamp`/`key`/`message` vs legacy `datetime`/`key`/`msg`):

```bash
bun -e "
const cfg = await Bun.file(process.env.HOME + '/.config/home/modules/unifi.json').json();
const r = await fetch(cfg.url + '/proxy/network/v2/api/site/' + cfg.site + '/system-log/all', {
  method: 'POST', tls: { rejectUnauthorized: false },
  headers: { 'X-API-KEY': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ pageNumber: 0, pageSize: 5 }),
});
console.log(r.status, (await r.text()).slice(0, 800));
"
```

Expected: 200 with a page of log rows. **If not 200 after reasonable variation (site id vs name, `categories` filter), stop: implement retirement instead (Task 12 pattern) and record the probe output in the commit message.**

- [x] **Step 2: Failing test** — normalize-mapper unit test using a captured row from Step 1 (assert the command's output row shape stays `{timestamp, key, message, …}` compatible with the current CommandSpec docs, adjusting docs if fields genuinely differ).
- [x] **Step 3: Implement** — `v2SystemLog(cfg, category, page)` helper in client.ts; `eventsList` → category `all`, `alarmsList` → `critical`; keep `--limit` mapping to `pageSize`.
- [x] **Step 4: Verify** — `bun run test` PASS; `--module unifi` e2e: `events list` + `alarms list` **pass**. Full module target: 46 pass / 0 fail (after Tasks 9+12+13; remaining unresolved are genuine empties, see Task 14 notes).
- [x] **Step 5: Skill regen + commit** — `bun run build:install && home skill install`; `git commit -m "feat(unifi): serve events/alarms from the v2 system-log"`

---

## Phase D — Providers & fixtures (e2e only; no src/ changes)

### Task 14: Fixtures file additions

**Files:**
- Modify: `e2e/fixtures.ts`

**Interfaces (produced — later tasks reference these exact names):**

```ts
export const fixtures = {
  sonosRoom: 'Living Room',                       // existing
  graphiteTrunk: 'main',
  githubRepo: 'uptonm/home',
  discordAlertsChannelId: '1453195143833321546',  // #alerts
}
```

- [x] **Step 1: Add the three keys.** Commit: `git commit -am "feat(e2e): fixtures for graphite trunk, github repo, discord alerts channel"`

Document (comment in fixtures.ts, one line each) the **manual env fixtures** that convert honest-unresolveds to passes whenever someone gets around to them — no code depends on them: HA Local Calendar integration (assistant `calendars get`); one saved Sonos playlist + one disabled Sonos alarm (no CLI create exists for either); optionally one UniFi hotspot voucher / firewall group / static route / RADIUS user; optionally one pinned GitHub issue in uptonm/home (repo currently has zero issues in any state).

### Task 15: github + graphite providers

**Files:**
- Modify: `e2e/args.ts` (new entries)

**Interfaces:**
- Consumes: Task 5's `listArgs` param, Task 14 fixtures, Task 6 environmental classification (covers arg-less `graphite repo trunk` on untracked branches).
- Field names verified: `PrSummary.number` (github client.ts:295-297), `RunSummary.id` = gh databaseId (client.ts:548-550), `IssueSummary.number` (client.ts:689-691). Graphite `stack get|branch parent|branch children` accept an optional `branch` positional routed through `gt info --branch`, verified passing from an untracked worktree.

- [x] **Step 1: Add providers**

```ts
  // github — chained off lists; --state all survives zero open PRs
  'github prs get': firstField('github', ['prs', 'list'], 'number', 'ref', ['--state', 'all', '--limit', '1']),
  'github prs checks': firstField('github', ['prs', 'list'], 'number', 'ref', ['--state', 'all', '--limit', '1']),
  'github prs diff': async () => {
    const base = await firstField('github', ['prs', 'list'], 'number', 'ref', ['--state', 'all', '--limit', '1'])()
    return { ...base, 'name-only': 'true' }
  },
  'github runs get': firstField('github', ['runs', 'list'], 'id', 'id'),
  'github issues get': firstField('github', ['issues', 'list'], 'number', 'ref', ['--state', 'all']),
  'github search code': fixed({ query: 'readGithubConfig', repo: fixtures.githubRepo, limit: '5' }),
  // graphite — pin reads to trunk so they work from untracked worktree branches
  'graphite stack get': fixed({ branch: fixtures.graphiteTrunk }),
  'graphite branch parent': fixed({ branch: fixtures.graphiteTrunk }),
  'graphite branch children': fixed({ branch: fixtures.graphiteTrunk }),
```

(Check the exact positional names in the github command specs — `ref` vs `id` — and the graphite `branchArg` name `branch` in `src/modules/graphite/commands/shared.ts:3-8`; adjust keys to match.)

- [x] **Step 2: Verify** — `--module github`: 12 pass / 0 fail / 1 unresolved (`issues get: list empty` until a repo issue exists). `--module graphite` from this worktree: 5 pass / 0 fail / 1 unresolved (`repo trunk`, environmental).

- [x] **Step 3: Commit** — `git commit -am "feat(e2e): github and graphite arg providers"`

### Task 16: protect + sonos provider corrections

**Files:**
- Modify: `e2e/args.ts:78` (protect events), `:116` (sonos playlists)

- [x] **Step 1: Two changes**

```ts
  'protect events get': firstField('protect', ['events', 'list'], 'id', 'id', ['--since', '7d', '--limit', '1']),
```

(A quiet hour defeats the 1h default window; the wider query is one extra authenticated GET — session persistence from #93 means no extra login. Check the exact flag names in `src/modules/protect/commands/events.ts:38`.)

```ts
  'sonos playlists get': firstField('sonos', ['playlists', 'list'], 'title', 'name'),
```

(Rows are `{title, itemId, uri}` — `src/modules/sonos/commands/playlists.ts:42`; the old `name` field never existed. Stays honestly `list empty` until a playlist is saved.)

- [x] **Step 2: Verify** — `--module protect`: `events get` **pass** (motion events exist within 7d); `--module sonos`: unchanged counts, but `playlists get` detail now reads `list empty`.

- [x] **Step 3: Commit** — `git commit -am "fix(e2e): protect events window and sonos playlists field"`

### Task 17: google-family providers (gmail ×4, gdrive ×1, gcal ×2)

**Files:**
- Modify: `e2e/args.ts:122-126` (replace the five speculative providers), plus two new gcal entries

**Interfaces:**
- Consumes: Task 6 `firstFieldIn`. Wrapped shapes verified: gmail lists return the raw Google page object (`{messages?}/{threads?}/{labels?}/{drafts?}` — `src/modules/gmail/client.ts:153-208`); gdrive `{files}` (`src/modules/gdrive/client.ts:231-239`); gcal `events list` output carries both `calendarId` and `events[]` (`src/modules/gcal/commands/events.ts:33,44`, `EventSummary.id` client.ts:242-247). **Do not flatten the module outputs** — pagination (`nextPageToken`) is load-bearing, documented API design.

- [x] **Step 1: Replace/add providers**

```ts
  'gmail messages get': firstFieldIn('gmail', ['messages', 'list'], 'messages', 'id', 'id'),
  'gmail threads get': firstFieldIn('gmail', ['threads', 'list'], 'threads', 'id', 'id'),
  'gmail labels get': firstFieldIn('gmail', ['labels', 'list'], 'labels', 'id', 'id'),
  'gmail drafts get': firstFieldIn('gmail', ['drafts', 'list'], 'drafts', 'id', 'id'),
  'gdrive files get': firstFieldIn('gdrive', ['files', 'list'], 'files', 'id', 'file'),
  'gcal events get': async () => {
    const d = (await cachedJson('gcal', ['events', 'list'])) as { calendarId?: string; events?: { id?: string }[] }
    const id = d.events?.[0]?.id
    if (!id) throw new Unresolved('gcal events list: no events[0].id')
    return { calendarId: d.calendarId ?? 'primary', eventId: id }
  },
  'gcal freebusy': async () => {
    const now = Date.now()
    return { from: new Date(now).toISOString(), to: new Date(now + 86_400_000).toISOString() }
  },
```

(Positional order for `events get` follows the spec — `calendarId` then `eventId` — which `buildArgv` preserves; `freebusy`'s `from`/`to` are string flags.)

- [x] **Step 2: Verify** — requires Google grants to be live (they were lost Jul 17; if `status` exits 3 the modules skip and that's designed behavior — note it and move on). With grants: `--module gmail` → up to 9/9 (drafts may stay `no drafts[] rows` — honest), `--module gdrive` → 2/2 reads, `--module gcal` → 5/5.

- [x] **Step 3: Commit** — `git commit -am "feat(e2e): google-family providers over wrapped list shapes"`

### Task 18: vercel + discord providers

**Files:**
- Modify: `e2e/args.ts`

**Interfaces:**
- Field names verified: `ProjectSummary` `id` (vercel client.ts:328), `DeploymentSummary` `id` (raw `uid` remapped at :456 — chain `id`, not `uid`), `TeamDomainSummary` `name` only (:618). All three lists emit bare arrays. `deployments events` needs only the `deployment` positional. Discord `list-channels` verified live: `#alerts` id `1453195143833321546`.

- [x] **Step 1: Add**

```ts
  'vercel projects get': firstField('vercel', ['projects', 'list'], 'id', 'project'),
  'vercel deployments get': firstField('vercel', ['deployments', 'list'], 'id', 'deployment'),
  'vercel deployments events': firstField('vercel', ['deployments', 'list'], 'id', 'deployment'),
  'vercel domains get': firstField('vercel', ['domains', 'list'], 'name', 'name'),
  'discord get-messages': fixed({ channelId: fixtures.discordAlertsChannelId }),
```

- [x] **Step 2: Verify** — `--module vercel` → 8/8 reads; `--module discord` → 2/2 reads.
- [x] **Step 3: Commit** — `git commit -am "feat(e2e): vercel and discord providers"`

### Task 19: linear + beszel + uptime-kuma providers

**Files:**
- Modify: `e2e/args.ts`

**Interfaces:**
- Field names verified: linear rows carry `identifier` (UPT-123) + `id` uuid, both accepted by `parseIssueRef` (client.ts:328) — use `identifier` for readable logs; project uuid path skips name-ambiguity resolution (projects.ts:87). Beszel `systems list` is a bare array with `id`; containers wrap as `{containers:[…]}` with `name` (adapter.ts:314), and `container-metrics get` accepts name only. Kuma `monitors list` wraps as `{monitors:[…]}` with stringified `id`; heartbeats requires the authenticated transport — verified `mode: "authenticated-socket"` live.

- [x] **Step 1: Add**

```ts
  'linear issues get': firstFieldIn('linear', ['issues', 'list'], 'issues', 'identifier', 'issue'),
  'linear issues search': fixed({ query: 'home' }),
  'linear projects get': firstFieldIn('linear', ['projects', 'list'], 'projects', 'id', 'project'),
  'beszel systems get': firstField('beszel', ['systems', 'list'], 'id', 'system'),
  'beszel metrics get': firstField('beszel', ['systems', 'list'], 'id', 'system'),
  'beszel smart get': firstField('beszel', ['systems', 'list'], 'id', 'system'),
  'beszel containers list': firstField('beszel', ['systems', 'list'], 'id', 'system'),
  'beszel containers get': beszelContainerRef,
  'beszel container-metrics get': beszelContainerRef,
  'uptime-kuma monitors get': firstFieldIn('uptime-kuma', ['monitors', 'list'], 'monitors', 'id', 'monitor'),
  'uptime-kuma heartbeats list': firstFieldIn('uptime-kuma', ['monitors', 'list'], 'monitors', 'id', 'monitor'),
```

With the compound provider (walks **up** systems — row 0 alone would flake on the long-down PVE host):

```ts
async function beszelContainerRef(): Promise<Record<string, string>> {
  const systems = (await rows('beszel', ['systems', 'list'])) as { id: string; status: string }[]
  for (const s of systems) {
    if (s.status !== 'up') continue
    const data = (await cachedJson('beszel', ['containers', 'list'], [s.id])) as { containers?: { name: string }[] }
    const name = data.containers?.[0]?.name
    if (name) return { system: s.id, container: name }
  }
  throw new Unresolved('beszel: no up system reporting containers')
}
```

(Check each spec's positional names — `issue`/`project`/`system`/`container`/`monitor` — against the command files and adjust keys to match.)

- [x] **Step 2: Verify** — `--module linear` → 9/9; `--module beszel` → 9/9; `--module uptime-kuma` → 8/8.
- [x] **Step 3: Commit** — `git commit -am "feat(e2e): linear, beszel, uptime-kuma providers"`

---

## Phase E — Full verification

### Task 20: Full reads-only run and report reconciliation

- [x] **Step 1:** `bun run typecheck && bun run test` — both clean.
- [x] **Step 2:** `bun e2e/run.ts --reads-only` (full, from this worktree). Expected end state:
  - **RESULT: PASS** — 0 failed reads, 0 failed scenarios.
  - Every remaining unresolved read is on the honest list: protect hardware-absent gets (`lights/sensors/doorlocks/chimes/viewers/bridges` — `list empty`), sonos `playlists get`/`alarms get` (`list empty` until app-side fixtures), unifi genuine empties (`vouchers/firewall/firewall-groups/routes/dpi-apps/radius-accounts get`), github `issues get` (`list empty`), graphite `repo trunk` (environmental, worktree only), gmail `drafts get` if the mailbox has no drafts, and the google modules wholesale if grants are still down (module skip, by design).
  - `needs attention` contains **only writes** (out of scope by request).
- [x] **Step 3:** Re-run from the main checkout (`cd ~/Projects/home && bun e2e/run.ts --reads-only --module graphite`) — graphite 6/6, proving the environmental classification didn't mask tracked-checkout behavior.
- [x] **Step 4:** Update this plan's checkboxes; final commit if reconciliation touched anything.

## Deferred (explicitly out of scope, tracked for later)

- **UniFi firewall → v2 `firewall-policies` migration**: `firewall list` currently passes-but-empty because this controller uses zone-based firewalling; the legacy `rest/firewallrule` sees nothing. Real feature work, not a test fix.
- **Write/scenario coverage** (`needs attention` writes, gdrive download/export temp-dir scenario, sonos scenarios beyond existing): user said readonly for now.
- **TUI wrapped-row repaint glitch** (`e2e/tui.ts:51-54` counts logical lines): cosmetic.
- **Per-host serialization for unifi+protect**: not needed — one login per run since #93, unifi is keyless header auth; revisit only if 429s reappear.
- **Manual env fixtures** listed in Task 14 — each converts one honest-unresolved to a pass; none block RESULT: PASS.
