---
spec: 000-CLI-OUTPUT-CONTRACT
---

# Schema-Declared Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a command declare the shape of its output so the formatter dispatches on a declared schema instead of guessing from the value at runtime.

**Architecture:** `RunResult` gains an optional `out` key naming a Zod schema; `ModuleManifest` gains an `outputs` thunk that dynamically imports the module's `output.ts`. `emit()` resolves the key only when the requested format needs to understand the shape, so `--json` never loads Zod. Commands without an `out` key keep today's behaviour, so migration is incremental and no task is a big-bang rewrite.

**Tech Stack:** Bun 1.3.14, TypeScript, Zod 4.4.3 (new, dynamically imported), Biome, `bun:test`.

## Global Constraints

Cited from [`000-CLI-OUTPUT-CONTRACT`](../specs/000-CLI-OUTPUT-CONTRACT.md) — read it before starting; it is not restated here.

- **`--json` bytes must not change.** 17 generated skills parse it. Any task that alters JSON output is wrong.
- **TSV stays the default** with no flag, byte-identical to today.
- **Never run bare `bun test`** — it bypasses `scripts/test-isolated.sh` and has destroyed real credentials. Use `bun run test` from `apps/home`, or `bun run home:test` from the repo root.
- **Bun only.** No node, npm, pnpm, yarn.
- **TypeScript only.** No `.js` files, including scripts.
- Latency budget is ~44 ms; the spec's measured deltas are +1 ms with Zod unresolved and +9 ms resolved.
- Zod is imported **only** through `ModuleManifest.outputs()`. A static `import { z } from 'zod'` anywhere reachable from `src/index.ts` defeats the whole design.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/types.ts` | Modify — `RunResult.out`, `ModuleManifest.outputs` |
| `src/core/output-shape.ts` | Create — schema → render shape, no I/O, no formatting |
| `src/core/formats.ts` | Create — one pure function per format |
| `src/core/output.ts` | Modify — `emit()` resolves and dispatches |
| `src/core/citty.ts` | Modify — `--format` flag, `--json` alias |
| `src/modules/<name>/output.ts` | Create per migrated module — Zod schemas |
| `scripts/build-local.sh` | Modify — add `--splitting` |
| `src/__tests__/output.test.ts` | Create — `emit()` characterization |
| `src/__tests__/output-shape.test.ts` | Create — schema dispatch |
| `src/__tests__/formats.test.ts` | Create — per-format golden output |
| `src/__tests__/output-keys.test.ts` | Create — registry walk |

---

### Task 1: Lock current `emit()` behaviour with tests

The spec calls this the largest known gap. It comes first because every later task changes `emit()`, and without these tests nothing would catch a regression that breaks all 17 skills at once.

**Files:**
- Test: `src/__tests__/output.test.ts` (create)

**Interfaces:**
- Consumes: `emit(result: RunResult, opts: { json: boolean }): Promise<never>` from `src/core/output.ts`
- Produces: `runEmit(result, opts): Promise<{ stdout: string; stderr: string; code: number }>` — a helper later tasks reuse

`emit()` calls `process.exit`, so it cannot be called in-process without killing the test runner. Spawn a subprocess instead.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/output.test.ts
import { expect, test } from 'bun:test'

const HARNESS = `
import { emit } from './src/core/output'
const result = JSON.parse(process.argv[2])
const opts = JSON.parse(process.argv[3])
await emit(result, opts)
`

async function runEmit(
  result: unknown,
  opts: { json: boolean },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(
    ['bun', 'run', '-', JSON.stringify(result), JSON.stringify(opts)],
    { stdin: new Response(HARNESS), stdout: 'pipe', stderr: 'pipe', cwd: import.meta.dir + '/../..' },
  )
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { stdout, stderr, code: await proc.exited }
}

test('payload goes to stdout, nothing else does', async () => {
  const r = await runEmit({ ok: true, data: 'hello' }, { json: false })
  expect(r.stdout).toBe('hello\n')
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)
})

test('--json emits exactly one parseable line', async () => {
  const r = await runEmit({ ok: true, data: { a: 1, b: [2, 3] } }, { json: true })
  const lines = r.stdout.trimEnd().split('\n')
  expect(lines).toHaveLength(1)
  expect(JSON.parse(lines[0])).toEqual({ a: 1, b: [2, 3] })
})

test('errors map to exit codes and land on stderr in human mode', async () => {
  const cases = [
    { kind: 'user', code: 1 },
    { kind: 'system', code: 2 },
    { kind: 'config', code: 3 },
  ] as const
  for (const c of cases) {
    const r = await runEmit({ ok: false, kind: c.kind, message: 'boom' }, { json: false })
    expect(r.code).toBe(c.code)
    expect(r.stderr).toBe('error: boom\n')
    expect(r.stdout).toBe('')
  }
})

test('errors in json mode go to stdout with the ok:false envelope', async () => {
  const r = await runEmit({ ok: false, kind: 'user', message: 'boom' }, { json: true })
  expect(JSON.parse(r.stdout)).toEqual({ ok: false, code: 'user', message: 'boom' })
  expect(r.code).toBe(1)
})

test('array of objects becomes TSV with a header row', async () => {
  const r = await runEmit({ ok: true, data: [{ a: 1, b: 2 }, { a: 3, b: 4 }] }, { json: false })
  expect(r.stdout).toBe('a\tb\n1\t2\n3\t4\n')
})

test('no ANSI escape reaches a non-TTY stdout', async () => {
  const r = await runEmit({ ok: true, data: 'plain' }, { json: false })
  expect(r.stdout).not.toMatch(/\[/)
})

test('undefined data writes nothing and still exits 0', async () => {
  const r = await runEmit({ ok: true }, { json: false })
  expect(r.stdout).toBe('')
  expect(r.code).toBe(0)
})
```

- [ ] **Step 2: Run it and confirm it passes against today's code**

Run: `cd apps/home && bun run test output.test.ts`

Expected: PASS, 7 tests. These characterize existing behaviour, so a failure here means the harness is wrong, not the code. Fix the harness until green.

- [ ] **Step 3: Commit**

```bash
git add apps/home/src/__tests__/output.test.ts
git commit -m "test(output): characterize emit() before changing it"
```

---

### Task 2: Add `out` and `outputs` to the type layer

**Files:**
- Modify: `src/core/types.ts:25-27` (`RunResult`), and `ModuleManifest`
- Test: `src/__tests__/output-keys.test.ts` (create)

**Interfaces:**
- Produces:
  - `RunResult` = `{ ok: true; data?: unknown; out?: string } | { ok: false; ... }`
  - `ModuleManifest.outputs?: () => Promise<Record<string, unknown>>`

`outputs` returns `unknown` values rather than `ZodType` so `types.ts` never imports Zod — importing the type alone would be erased at build time, but the rule is easier to enforce as "types.ts mentions no Zod at all".

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/output-keys.test.ts
import { expect, test } from 'bun:test'
import { modules } from '../registry'

test('every out key resolves to a schema in its module outputs', async () => {
  const missing: string[] = []
  for (const m of modules) {
    const keys = new Set<string>()
    for (const c of m.commands) if (c.outKey) keys.add(c.outKey)
    if (keys.size === 0) continue
    expect(m.outputs, `${m.name} declares out keys but no outputs()`).toBeDefined()
    const schemas = await m.outputs!()
    for (const k of keys) if (!(k in schemas)) missing.push(`${m.name}.${k}`)
  }
  expect(missing).toEqual([])
})
```

Note: this reads `c.outKey` — a **static** declaration on `CommandSpec`, distinct from the `out` a run returns. Add both; the static one is what makes the walk possible without executing anything.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/home && bun run test output-keys.test.ts`
Expected: FAIL — `Property 'outKey' does not exist on type 'CommandSpec'`

- [ ] **Step 3: Add the fields**

```ts
// src/core/types.ts — replace the RunResult block
export type RunResult =
  | { ok: true; data?: unknown; out?: string }
  | { ok: false; kind: 'user' | 'system' | 'config'; message: string; code?: string }
```

In `CommandSpec`, after `examples`:

```ts
  /**
   * Names a schema in this module's `outputs()`. Declared statically so the
   * framework can resolve the shape before `run` executes, and so a test can
   * walk every command without invoking anything.
   */
  outKey?: string
```

In `ModuleManifest`, after `commands`:

```ts
  /**
   * Lazily loads this module's output schemas. Must be a dynamic import —
   * a static one pulls Zod into every invocation's module graph.
   */
  outputs?: () => Promise<Record<string, unknown>>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/home && bun run test output-keys.test.ts`
Expected: PASS (vacuously — no module declares `outKey` yet)

Run: `bun run typecheck`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add apps/home/src/core/types.ts apps/home/src/__tests__/output-keys.test.ts
git commit -m "feat(output): declare outKey and outputs on the type layer"
```

---

### Task 3: Derive a render shape from a schema

**Files:**
- Create: `src/core/output-shape.ts`
- Test: `src/__tests__/output-shape.test.ts`
- Modify: `apps/home/package.json` (add Zod)

**Interfaces:**
- Produces:
  - `type Shape = { kind: 'text' } | { kind: 'record'; columns: Column[] } | { kind: 'table'; columns: Column[] } | { kind: 'unknown' }`
  - `type Column = { key: string; label: string; blob: boolean }`
  - `shapeOf(schema: unknown): Shape`

All Zod access is through `.def`, verified against 4.4.3: `.def.type` is `'string' | 'object' | 'array' | 'optional'`, `.def.shape` holds an object's fields, `.def.element` an array's element, `.def.innerType` an optional's inner, and `.meta()` returns the metadata record or `undefined`.

- [ ] **Step 1: Install Zod**

```bash
cd apps/home && bun add zod@4.4.3
```

Expected: `apps/home/package.json` gains `"zod": "4.4.3"` in `dependencies`.

- [ ] **Step 2: Write the failing test**

```ts
// src/__tests__/output-shape.test.ts
import { expect, test } from 'bun:test'
import { z } from 'zod'
import { shapeOf } from '../core/output-shape'

test('a bare string is a text blob', () => {
  expect(shapeOf(z.string())).toEqual({ kind: 'text' })
})

test('an object is a record with declared column order', () => {
  const s = z.object({ name: z.string(), ip: z.string(), port: z.number() })
  expect(shapeOf(s)).toEqual({
    kind: 'record',
    columns: [
      { key: 'name', label: 'name', blob: false },
      { key: 'ip', label: 'ip', blob: false },
      { key: 'port', label: 'port', blob: false },
    ],
  })
})

test('an array of objects is a table', () => {
  const s = z.array(z.object({ mac: z.string(), ip: z.string() }))
  expect(shapeOf(s).kind).toBe('table')
  expect(shapeOf(s).kind === 'table' && shapeOf(s).columns.map((c) => c.key)).toEqual(['mac', 'ip'])
})

test('meta label overrides the column header', () => {
  const s = z.object({ ip: z.string().meta({ label: 'IP address' }) })
  expect(shapeOf(s)).toEqual({
    kind: 'record',
    columns: [{ key: 'ip', label: 'IP address', blob: false }],
  })
})

test('meta render:blob marks a field as a blob', () => {
  const s = z.object({ patch: z.string().meta({ render: 'blob' }), truncated: z.boolean() })
  const shape = shapeOf(s)
  expect(shape.kind === 'record' && shape.columns[0]).toEqual({
    key: 'patch',
    label: 'patch',
    blob: true,
  })
})

test('optional fields are unwrapped, not skipped', () => {
  const s = z.object({ patch: z.string().meta({ render: 'blob' }).optional() })
  const shape = shapeOf(s)
  expect(shape.kind === 'record' && shape.columns[0].blob).toBe(true)
})

test('anything else is unknown and falls back to legacy formatting', () => {
  expect(shapeOf(z.number())).toEqual({ kind: 'unknown' })
  expect(shapeOf(undefined)).toEqual({ kind: 'unknown' })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/home && bun run test output-shape.test.ts`
Expected: FAIL — cannot find module `../core/output-shape`

- [ ] **Step 4: Implement**

```ts
// src/core/output-shape.ts
export interface Column {
  key: string
  label: string
  blob: boolean
}

export type Shape =
  | { kind: 'text' }
  | { kind: 'record'; columns: Column[] }
  | { kind: 'table'; columns: Column[] }
  | { kind: 'unknown' }

interface ZodLike {
  def?: { type?: string; shape?: Record<string, ZodLike>; element?: ZodLike; innerType?: ZodLike }
  meta?: () => Record<string, unknown> | undefined
}

function unwrap(node: ZodLike): ZodLike {
  let current = node
  while (current.def?.type === 'optional' || current.def?.type === 'nullable') {
    const inner = current.def.innerType
    if (!inner) break
    current = inner
  }
  return current
}

function columnsOf(shape: Record<string, ZodLike>): Column[] {
  return Object.entries(shape).map(([key, field]) => {
    const meta = unwrap(field).meta?.() ?? field.meta?.() ?? {}
    return {
      key,
      label: typeof meta.label === 'string' ? meta.label : key,
      blob: meta.render === 'blob',
    }
  })
}

export function shapeOf(schema: unknown): Shape {
  if (!schema || typeof schema !== 'object') return { kind: 'unknown' }
  const node = unwrap(schema as ZodLike)
  const type = node.def?.type

  if (type === 'string') return { kind: 'text' }
  if (type === 'object' && node.def?.shape) {
    return { kind: 'record', columns: columnsOf(node.def.shape) }
  }
  if (type === 'array' && node.def?.element) {
    const element = unwrap(node.def.element)
    if (element.def?.type === 'object' && element.def.shape) {
      return { kind: 'table', columns: columnsOf(element.def.shape) }
    }
  }
  return { kind: 'unknown' }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/home && bun run test output-shape.test.ts`
Expected: PASS, 7 tests

`.meta()` on an optional lives on the *outer* wrapper in Zod 4.4.3 when written as `.meta().optional()`, and on the inner when written `.optional().meta()`. `columnsOf` checks unwrapped first, then the wrapper, so both spellings work. If the optional test fails, that ordering is the thing to inspect.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/core/output-shape.ts apps/home/src/__tests__/output-shape.test.ts apps/home/package.json apps/home/bun.lock
git commit -m "feat(output): derive render shape from a zod schema"
```

---

### Task 4: One pure function per format

**Files:**
- Create: `src/core/formats.ts`
- Test: `src/__tests__/formats.test.ts`

**Interfaces:**
- Consumes: `Shape`, `Column` from `src/core/output-shape.ts`
- Produces: `formatAs(format: Format, data: unknown, shape: Shape): string`, `type Format = 'tsv' | 'json' | 'csv' | 'yaml' | 'pretty' | 'text'`

TSV output for a table must stay byte-identical to today's, with the one intended change that column order now comes from the schema.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/formats.test.ts
import { expect, test } from 'bun:test'
import { formatAs } from '../core/formats'
import type { Shape } from '../core/output-shape'

const TABLE: Shape = {
  kind: 'table',
  columns: [
    { key: 'mac', label: 'mac', blob: false },
    { key: 'ip', label: 'IP address', blob: false },
  ],
}
const ROWS = [
  { mac: 'aa:bb', ip: '10.0.14.60' },
  { mac: 'cc:dd', ip: '10.0.14.61' },
]

test('tsv uses schema column order and raw keys as headers', () => {
  expect(formatAs('tsv', ROWS, TABLE)).toBe('mac\tip\naa:bb\t10.0.14.60\ncc:dd\t10.0.14.61')
})

test('tsv column order follows the schema, not the data', () => {
  const reordered = [{ ip: '10.0.14.60', mac: 'aa:bb' }]
  expect(formatAs('tsv', reordered, TABLE)).toBe('mac\tip\naa:bb\t10.0.14.60')
})

test('csv quotes only when required, per RFC 4180', () => {
  const shape: Shape = {
    kind: 'table',
    columns: [
      { key: 'a', label: 'a', blob: false },
      { key: 'b', label: 'b', blob: false },
    ],
  }
  const rows = [{ a: 'plain', b: 'has,comma' }, { a: 'has"quote', b: 'has\nnewline' }]
  expect(formatAs('csv', rows, shape)).toBe(
    'a,b\nplain,"has,comma"\n"has""quote","has\nnewline"',
  )
})

test('csv uses labels as headers where tsv uses keys', () => {
  expect(formatAs('csv', ROWS, TABLE).split('\n')[0]).toBe('mac,IP address')
})

test('a text blob is emitted raw and never re-encoded', () => {
  const patch = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n+added'
  expect(formatAs('text', patch, { kind: 'text' })).toBe(patch)
})

test('a record with a blob field emits the blob alone', () => {
  const shape: Shape = {
    kind: 'record',
    columns: [
      { key: 'patch', label: 'patch', blob: true },
      { key: 'truncated', label: 'truncated', blob: false },
    ],
  }
  expect(formatAs('text', { patch: 'raw\npatch', truncated: false }, shape)).toBe('raw\npatch')
})

test('yaml round-trips through Bun.YAML', () => {
  const out = formatAs('yaml', ROWS, TABLE)
  expect(Bun.YAML.parse(out)).toEqual(ROWS)
})

test('json ignores the shape entirely', () => {
  expect(formatAs('json', ROWS, TABLE)).toBe(JSON.stringify(ROWS))
})

test('pretty renders a box-drawing table', () => {
  expect(formatAs('pretty', ROWS, TABLE)).toContain('┌')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/home && bun run test formats.test.ts`
Expected: FAIL — cannot find module `../core/formats`

- [ ] **Step 3: Implement**

```ts
// src/core/formats.ts
import type { Column, Shape } from './output-shape'

export type Format = 'tsv' | 'json' | 'csv' | 'yaml' | 'pretty' | 'text'

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function csvField(v: unknown): string {
  const s = cell(v)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function rowsOf(data: unknown, shape: Shape): Record<string, unknown>[] {
  if (shape.kind === 'table') return (data as Record<string, unknown>[]) ?? []
  if (shape.kind === 'record') return data ? [data as Record<string, unknown>] : []
  return []
}

function blobOf(data: unknown, shape: Shape): string | undefined {
  if (shape.kind === 'text') return cell(data)
  if (shape.kind !== 'record') return undefined
  const blob = shape.columns.find((c) => c.blob)
  if (!blob) return undefined
  const value = (data as Record<string, unknown>)?.[blob.key]
  return value === undefined ? undefined : cell(value)
}

function delimited(
  data: unknown,
  shape: Shape,
  sep: string,
  header: (c: Column) => string,
  escape: (v: unknown) => string,
): string {
  const columns = shape.kind === 'table' || shape.kind === 'record' ? shape.columns : []
  const rows = rowsOf(data, shape)
  const head = columns.map(header).join(sep)
  const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(sep))
  return [head, ...body].join('\n')
}

export function formatAs(format: Format, data: unknown, shape: Shape): string {
  if (format === 'json') return JSON.stringify(data)
  if (format === 'yaml') return Bun.YAML.stringify(data)

  const blob = blobOf(data, shape)
  if (format === 'text') return blob ?? delimited(data, shape, '\t', (c) => c.key, cell)
  if (format === 'tsv') return delimited(data, shape, '\t', (c) => c.key, cell)
  if (format === 'csv') return delimited(data, shape, ',', (c) => c.label, csvField)
  return Bun.inspect.table(rowsOf(data, shape))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/home && bun run test formats.test.ts`
Expected: PASS, 9 tests

If the yaml test fails on a Bun version without `Bun.YAML.stringify`, stop and report — the spec's format table depends on it and there is no in-house fallback planned.

- [ ] **Step 5: Commit**

```bash
git add apps/home/src/core/formats.ts apps/home/src/__tests__/formats.test.ts
git commit -m "feat(output): add one pure formatter per format"
```

---

### Task 5: Resolve the schema inside `emit()` and add `--format`

**Files:**
- Modify: `src/core/output.ts`
- Modify: `src/core/citty.ts:11-15` (`globalFlags`), `:60-69` (`ctxFromArgs`), and every `emit(...)` call site
- Test: `src/__tests__/output.test.ts` (extend)

**Interfaces:**
- Consumes: `formatAs`, `Format`, `shapeOf`, `Shape`
- Produces: `emit(result: RunResult, opts: { format: Format; outputs?: () => Promise<Record<string, unknown>> }): Promise<never>`

`EmitOptions.json` becomes `format`. Every call site in `citty.ts` passes `{ format: env.format, outputs: manifest.outputs }`.

- [ ] **Step 1: Migrate Task 1's tests to the new option shape**

`EmitOptions.json` no longer exists, so every `runEmit(..., { json: true })` in
`output.test.ts` becomes `{ format: 'json' }` and every `{ json: false }`
becomes `{ format: 'tsv' }`. Do this first and confirm the suite is still green
before adding anything — those seven tests are the safety net for this task, and
their assertions must not change, only their arguments.

Record the pre-migration `--json` bytes as a literal so the guarantee is pinned
to a constant rather than to a second call:

```ts
test('--format json emits the exact bytes --json used to', async () => {
  const r = await runEmit({ ok: true, data: { a: 1, b: [2, 3] } }, { format: 'json' })
  expect(r.stdout).toBe('{"a":1,"b":[2,3]}\n')
})

test('json output does not resolve the schema', async () => {
  const r = await runEmit(
    { ok: true, data: { patch: 'x' }, out: 'doesNotExist' },
    { format: 'json' },
  )
  expect(JSON.parse(r.stdout)).toEqual({ patch: 'x' })
  expect(r.code).toBe(0)
})

test('an unresolvable out key in a human format is a system error', async () => {
  const r = await runEmit(
    { ok: true, data: { patch: 'x' }, out: 'doesNotExist' },
    { format: 'tsv' },
  )
  expect(r.code).toBe(2)
  expect(r.stderr).toContain('doesNotExist')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/home && bun run test output.test.ts`
Expected: FAIL — `--format` is not honoured; the third test exits 0 instead of 2

- [ ] **Step 3: Implement**

```ts
// src/core/output.ts — replace EmitOptions, emit, and formatHuman
import type { Writable } from 'node:stream'
import { type Format, formatAs } from './formats'
import { type Shape, shapeOf } from './output-shape'
import type { RunResult } from './types'

export interface EmitOptions {
  format: Format
  outputs?: () => Promise<Record<string, unknown>>
}

function drain(stream: Writable, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (err) => (err ? reject(err) : resolve()))
  })
}

async function resolveShape(opts: EmitOptions, out: string | undefined): Promise<Shape> {
  if (!out || !opts.outputs) return { kind: 'unknown' }
  const schemas = await opts.outputs()
  if (!(out in schemas)) throw new Error(`unknown output key: ${out}`)
  return shapeOf(schemas[out])
}

export async function emit(result: RunResult, opts: EmitOptions): Promise<never> {
  if (result.ok) {
    if (result.data !== undefined && result.data !== null) {
      if (opts.format === 'json') {
        await drain(process.stdout, JSON.stringify(result.data) + '\n')
      } else {
        let shape: Shape
        try {
          shape = await resolveShape(opts, result.out)
        } catch (err) {
          await drain(process.stderr, `error: ${(err as Error).message}\n`)
          process.exit(2)
        }
        const text =
          shape.kind === 'unknown'
            ? formatLegacy(result.data)
            : formatAs(opts.format, result.data, shape)
        await drain(process.stdout, text + '\n')
      }
    }
    process.exit(0)
  }
  const code = result.kind === 'config' ? 3 : result.kind === 'user' ? 1 : 2
  if (opts.format === 'json') {
    await drain(
      process.stdout,
      JSON.stringify({ ok: false, code: result.code ?? result.kind, message: result.message }) +
        '\n',
    )
  } else {
    await drain(process.stderr, `error: ${result.message}\n`)
  }
  process.exit(code)
}
```

Keep the existing `formatHuman`, `formatTable` and `stringify` in the same file, renaming `formatHuman` to `formatLegacy`. That is the path every unmigrated command still takes; deleting it is Task 8's job, not this one's.

In `src/core/citty.ts`, extend `globalFlags`:

```ts
const globalFlags: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout (silent otherwise)' },
  format: {
    type: 'string',
    description: 'Output format: tsv (default), json, csv, yaml, pretty, text',
  },
  // ...existing quiet / verbose entries unchanged
}
```

and in `ctxFromArgs`, derive the format with `--json` winning so no skill changes behaviour. `citty.ts` needs `import type { Format } from './formats'` at the top:

```ts
const json = Boolean(raw.json)
const format: Format = json ? 'json' : ((raw.format as Format) ?? 'tsv')
```

An unrecognised `--format` value must be a user error, not a silent fallback to
`tsv` — a typo that quietly produces the default format is worse than one that
fails:

```ts
const FORMATS: readonly Format[] = ['tsv', 'json', 'csv', 'yaml', 'pretty', 'text']
if (raw.format !== undefined && !FORMATS.includes(raw.format as Format)) {
  await emit(
    { ok: false, kind: 'user', message: `unknown format: ${raw.format}` },
    { format: 'tsv' },
  )
}
```

Return `format` alongside `json` from `ctxFromArgs`, and change each `emit(x, { json: env.json })` call to `emit(x, { format: env.format, outputs: manifest.outputs })`. In `buildRootCommand` and any call site with no manifest in scope, pass `{ format: env.format }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/home && bun run test output.test.ts`
Expected: PASS, 11 tests

Run: `bun run typecheck`
Expected: clean — the compiler will list every `emit()` call site still passing `json`

- [ ] **Step 5: Run the whole suite**

Run: `cd apps/home && bun run test`
Expected: all files pass. Anything asserting on human output is a real regression; fix the code, not the test.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/core/output.ts apps/home/src/core/citty.ts apps/home/src/__tests__/output.test.ts
git commit -m "feat(output): resolve schemas in emit and add --format"
```

---

### Task 6: Keep Zod off the hot path

**Files:**
- Modify: `scripts/build-local.sh:41-45`
- Test: `src/__tests__/output-lazy.test.ts` (create)

**Interfaces:**
- Consumes: the built binary at `dist/home`

Without `--splitting`, `bun build --compile` evaluates the dynamically imported chunk at startup and the design's whole saving disappears — silently, with every test still green. This task exists to make that regression loud.

- [ ] **Step 1: Add `--splitting` to the build**

```bash
bun build --compile --splitting --target="$TARGET" \
  --define "__HOME_VERSION=\"$VERSION\"" \
  --define "__HOME_COMMIT=\"$COMMIT\"" \
  "$REPO/src/index.ts" \
  --outfile "$OUTFILE"
```

While in this file, replace the Node shell-out on the `VERSION` line — the repo is Bun-only:

```bash
VERSION="$(bun --print "require('$REPO/package.json').version")"
```

- [ ] **Step 2: Write the failing test**

```ts
// src/__tests__/output-lazy.test.ts
import { expect, test } from 'bun:test'

test('the json path does not evaluate zod', async () => {
  const proc = Bun.spawn([`${import.meta.dir}/../../dist/home`, '--version', '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, BUN_INSPECT_MODULES: '1' },
  })
  await proc.exited
  const loaded = await new Response(proc.stderr).text()
  expect(loaded).not.toContain('zod')
})
```

If `BUN_INSPECT_MODULES` is unavailable in Bun 1.3.14, replace the assertion with a timing guard: build once with `--splitting` and once without, and assert the `--json` path is at least 4 ms faster. Record whichever mechanism you used in the commit message, because the next person needs to know what is actually being protected.

- [ ] **Step 3: Build and run**

Run: `cd apps/home && bun run build && bun run test output-lazy.test.ts`
Expected: PASS

- [ ] **Step 4: Verify the binary still works end to end**

```bash
cd apps/home && ./dist/home --version && ./dist/home status --json | head -1
```

Expected: a version string, then one line of parseable JSON. `--splitting` with `--compile` produces a single self-contained binary; if `dist/` now contains loose chunk files, stop and report.

- [ ] **Step 5: Commit**

```bash
git add apps/home/scripts/build-local.sh apps/home/src/__tests__/output-lazy.test.ts
git commit -m "build: split chunks so zod stays off the json path"
```

---

### Task 7: Migrate `github prs diff` and `graphite stack list`

**Files:**
- Create: `src/modules/github/output.ts`, `src/modules/graphite/output.ts`
- Modify: `src/modules/github/index.ts`, `src/modules/github/commands/prs.ts:73-94`
- Modify: `src/modules/graphite/index.ts`, and the `stack list` command spec
- Test: `src/__tests__/output-migration.test.ts` (create)

**Interfaces:**
- Consumes: `ModuleManifest.outputs`, `CommandSpec.outKey`, `RunResult.out`
- Produces: schema keys `prDiff` (github) and `stackList` (graphite)

These are the two commands the spec names as relaying artifacts they never render.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/output-migration.test.ts
import { expect, test } from 'bun:test'
import { shapeOf } from '../core/output-shape'
import githubManifest from '../modules/github'

test('prs diff renders the patch as a raw blob', async () => {
  const schemas = await githubManifest.outputs!()
  const shape = shapeOf(schemas.prDiff)
  expect(shape.kind).toBe('record')
  const patch = shape.kind === 'record' && shape.columns.find((c) => c.key === 'patch')
  expect(patch && patch.blob).toBe(true)
})

test('prs diff still declares the same json payload', async () => {
  const schemas = await githubManifest.outputs!()
  const parsed = (schemas.prDiff as { parse: (v: unknown) => unknown }).parse({
    patch: 'diff --git a/x b/x',
    truncated: false,
  })
  expect(parsed).toEqual({ patch: 'diff --git a/x b/x', truncated: false })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/home && bun run test output-migration.test.ts`
Expected: FAIL — `githubManifest.outputs` is undefined

- [ ] **Step 3: Add the schemas**

```ts
// src/modules/github/output.ts
import { z } from 'zod'

export const prDiff = z.object({
  files: z.array(z.string()).optional(),
  patch: z.string().meta({ render: 'blob' }).optional(),
  truncated: z.boolean(),
})
```

```ts
// src/modules/graphite/output.ts
import { z } from 'zod'

export const stackList = z.object({
  raw: z.string().meta({ render: 'blob' }),
  rawTruncated: z.boolean(),
  branches: z.array(z.unknown()),
  topology: z.unknown(),
})
```

- [ ] **Step 4: Wire them to the manifests**

In `src/modules/github/index.ts`, add to the exported manifest object:

```ts
  outputs: () => import('./output'),
```

Do the same in `src/modules/graphite/index.ts`. This is the only place a module references its schemas, and it must stay a dynamic `import()`.

In `src/modules/github/commands/prs.ts`, add `outKey` to the spec and `out` to the result:

```ts
export const prsDiff: CommandSpec = {
  path: ['prs', 'diff'],
  effect: 'read',
  outKey: 'prDiff',
  // ...description, args, examples unchanged
  async run(ctx) {
    const cfg = readGithubConfig(ctx.config)
    const data = await getPrDiff(cfg, requiredRef(ctx, 'ref'), {
      repo: optionalString(ctx, 'repo'),
      nameOnly: Boolean(ctx.args['name-only']),
    })
    return { ok: true, data, out: 'prDiff' }
  },
}
```

Apply the same two-line change to graphite's `stack list` spec with `outKey: 'stackList'` and `out: 'stackList'`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/home && bun run test output-migration.test.ts output-keys.test.ts`
Expected: PASS — and `output-keys` is now non-vacuous, walking two real keys

- [ ] **Step 6: Verify the bug is actually fixed**

```bash
cd apps/home && bun run build
./dist/home github prs diff 107 --repo uptonm/home | head -5
./dist/home github prs diff 107 --repo uptonm/home --json | head -c 200
```

Expected: the first prints a real patch with real newlines and no leading `{`; the second prints the unchanged `{"patch":"..."}` envelope. If the human output still shows `\n` escapes, the `out` key is not reaching `emit`.

- [ ] **Step 7: Commit**

```bash
git add apps/home/src/modules/github apps/home/src/modules/graphite apps/home/src/__tests__/output-migration.test.ts
git commit -m "feat(github,graphite): declare output schemas for relayed blobs"
```

---

### Task 8: Migrate the remaining modules and delete the legacy path

**Files:**
- Create: `src/modules/<name>/output.ts` for the 15 remaining modules
- Modify: each module's `index.ts` and command specs
- Modify: `src/core/output.ts` — remove `formatLegacy`, `formatTable`, `stringify`
- Modify: `src/__tests__/output-keys.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: no command reaches `formatLegacy`

Do this **one module per commit**. A module is done when every one of its commands has an `outKey` and the suite is green.

- [ ] **Step 1: Tighten the walk test to require full coverage**

```ts
test('every command declares an out key', () => {
  const undeclared: string[] = []
  for (const m of modules) {
    for (const c of m.commands) if (!c.outKey) undeclared.push(`${m.name} ${c.path.join(' ')}`)
  }
  expect(undeclared).toEqual([])
})
```

- [ ] **Step 2: Run it to see the full worklist**

Run: `cd apps/home && bun run test output-keys.test.ts`
Expected: FAIL, listing every command still to migrate. That list is the task backlog.

- [ ] **Step 3: Migrate one module at a time**

For each module: write `output.ts` with one schema per command, add `outputs: () => import('./output')` to the manifest, add `outKey` and `out` to each command, then run `bun run test` and commit. Repeat until Step 2's list is empty.

Where a command returns a plain string today, the schema is `z.string()` and the shape is `text` — output is unchanged.

- [ ] **Step 4: Delete the legacy formatter**

Once the walk test passes, remove `formatLegacy`, `formatTable` and `stringify` from `src/core/output.ts`, and simplify `emit` so `shape.kind === 'unknown'` is a thrown system error rather than a fallback.

- [ ] **Step 5: Verify nothing regressed**

Run: `cd apps/home && bun run test && bun run typecheck`
Expected: all green

Run from the repo root: `bun run ci`
Expected: typecheck, test, site lint and site build all pass

- [ ] **Step 6: Regenerate the skills**

```bash
cd apps/home && bun run build:install && home skill install
```

Required, not optional — skipping it is how installed skills drift behind the registry.

- [ ] **Step 7: Commit**

```bash
git add -A apps/home
git commit -m "refactor(output): drop the legacy formatter; every command declares a shape"
```

---

## Landing

Update [`000-CLI-OUTPUT-CONTRACT`](../specs/000-CLI-OUTPUT-CONTRACT.md): drop all four `PLANNED` markers, and correct the dependency count from five to six. Then append `## Landed` here with the date, commit range, what was verified, and any correction the work produced.
