---
spec: 005-MODULE-SYSTEM
---

# Module Paths and Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a module choose where it mounts in the CLI, independently of its name and its connection, and mount it at a short alias as well.

**Architecture:** `ModuleManifest` gains `path` and `shortPath`. The root command tree is assembled by nesting module trees under their path segments rather than keying them by name, and the same `CommandDef` is mounted a second time at `shortPath`. Shell completion and skill rendering follow. This is what makes `home cloudflare dns list` possible without `dns` being a top-level command, while `home gmail messages list` keeps working.

**Tech Stack:** TypeScript, Bun, citty, consola.

## Global Constraints

- Bun ≥ 1.3.0, TypeScript only. Tests with `bun test` from `apps/home`; types with `bun run typecheck`.
- Path, alias, and skill-naming rules are specified in [`005-MODULE-SYSTEM`](../specs/005-MODULE-SYSTEM.md).
- Requires [`006-CONNECTION-LAYER`](006-CONNECTION-LAYER.md). Independent of [`007-GOOGLE-CONNECTION-CLEANUP`](007-GOOGLE-CONNECTION-CLEANUP.md).
- `buildCommandTree` (`core/citty.ts:220`) and `moduleNode` (`core/completion.ts:71`) both carry a "max depth 2" assumption and an explicit comment telling you to keep them in sync. Both change here; keep the comment accurate.
- Overlaps [`005-SCHEMA-OUTPUT`](005-SCHEMA-OUTPUT.md), which is approved and may land first. That plan adds `out` to `RunResult` **and an `outputs` thunk to `ModuleManifest`** in `src/core/types.ts`, plus `--format` to `globalFlags` and a rewritten `emit()` path in `src/core/citty.ts`. The two are independent in substance — different fields, different functions — but they edit the same two files and both touch `makeUserLeaf`. Land one fully before starting the other, and expect the second to rebase through the first.
- Command paths change, so this plan ends with `bun run build:install && home skill install`.

---

### Task 1: Declare paths on every module

**Files:**
- Modify: `apps/home/src/core/types.ts`
- Modify: every `apps/home/src/modules/*/index.ts`
- Modify: `apps/home/src/core/connections.ts` (`validateRegistry`)
- Modify: `apps/home/src/__tests__/connections.test.ts`

**Interfaces:**
- Produces:
  - `ModuleManifest.path: string[]` — required, where the module mounts
  - `ModuleManifest.shortPath?: string[]` — optional alternate mount
  - `validateRegistry` gains a `duplicate_path` violation kind

Every existing module takes `path: ['<name>']` and no `shortPath`, so no invocation changes in this task. The Google trio keeps `path: ['gmail']` for now — moving it to `['google','gmail']` is Task 4, once nesting works.

- [ ] **Step 1: Write the failing test**

Add to `apps/home/src/__tests__/connections.test.ts`, and extend the `mod` helper there to take an optional path:

```ts
function modAt(name: string, connection: string, path: string[], shortPath?: string[]): ModuleManifest {
  return { ...mod(name, connection), path, ...(shortPath ? { shortPath } : {}) }
}

describe('validateRegistry paths', () => {
  test('flags two modules mounting at the same path', () => {
    const violations = validateRegistry(
      [conn('a'), conn('b')],
      [modAt('one', 'a', ['dns']), modAt('two', 'b', ['dns'])],
    )
    expect(violations).toEqual([
      { kind: 'duplicate_path', detail: 'path "dns" is claimed by more than one module' },
    ])
  })

  test('flags a shortPath colliding with another module path', () => {
    const violations = validateRegistry(
      [conn('a'), conn('b')],
      [modAt('one', 'a', ['cloudflare', 'dns'], ['dns']), modAt('two', 'b', ['dns'])],
    )
    expect(violations).toEqual([
      { kind: 'duplicate_path', detail: 'path "dns" is claimed by more than one module' },
    ])
  })

  test('accepts distinct paths and a nested path sharing its first segment', () => {
    const violations = validateRegistry(
      [conn('a'), conn('b')],
      [modAt('one', 'a', ['cloudflare', 'dns']), modAt('two', 'b', ['cloudflare', 'workers'])],
    )
    expect(violations).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/connections.test.ts`
Expected: FAIL — `path` is not a property of `ModuleManifest`, and no `duplicate_path` violation exists.

- [ ] **Step 3: Add the fields**

In `apps/home/src/core/types.ts`, add to `ModuleManifest` under `connection`:

```ts
  /**
   * Where this module mounts in the CLI, independent of `name` and of
   * `connection`. `cloudflare-dns` mounts at ['cloudflare','dns'] because that
   * reads well, not because it connects via `cloudflare`.
   */
  path: string[]
  /** A second, shorter mount for the same commands — e.g. ['gmail']. */
  shortPath?: string[]
```

- [ ] **Step 4: Add the path invariant**

In `apps/home/src/core/connections.ts`, add `'duplicate_path'` to `RegistryViolation['kind']` and append to `validateRegistry` before the return:

```ts
  const mounts = modules.flatMap((m) => [m.path, ...(m.shortPath ? [m.shortPath] : [])])
  for (const claimed of duplicates(mounts.map((p) => p.join(' ')))) {
    out.push({ kind: 'duplicate_path', detail: `path "${claimed}" is claimed by more than one module` })
  }
```

- [ ] **Step 5: Give every module a path**

Add `path: ['<name>'],` under `connection:` in each `apps/home/src/modules/*/index.ts`. Update every `ModuleManifest` fixture in `src/__tests__/` to carry a `path` — do not make the field optional to avoid the churn.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/home/src
git commit -m "feat(core): modules declare their CLI path"
```

---

### Task 2: Mount the command tree by path

**Files:**
- Modify: `apps/home/src/core/citty.ts:220-265` (`buildCommandTree`)
- Modify: `apps/home/src/index.ts:23`
- Test: `apps/home/src/__tests__/command-mounting.test.ts`

**Interfaces:**
- Consumes: `buildCommandTree(manifest: ModuleManifest, registered: ConnectionManifest[]): CommandDef` — the two-argument form plan 000 task 3 introduced.
- Produces: `mountModules(modules: ModuleManifest[], registered: ConnectionManifest[]): Record<string, CommandDef>` exported from `src/core/citty.ts`, replacing the `Object.fromEntries(modules.map(...))` in `index.ts`.

`buildCommandTree` still builds one module's own subtree and keeps its internal max-depth-2 assumption. What changes is that the result is now nested under path segments rather than registered at `manifest.name`, and mounted twice when `shortPath` is set.

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/command-mounting.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import type { CommandDef } from 'citty'
import { mountModules } from '../core/citty'
import type { CommandSpec, ConnectionManifest, ModuleManifest } from '../core/types'

/** One trivial connection per module, so mounting never fails to resolve one. */
function connsFor(modules: ModuleManifest[]): ConnectionManifest[] {
  return modules.map((m) => ({
    name: m.connection,
    description: m.connection,
    configSchema: [],
    async status() {
      return { ok: true }
    },
  }))
}

function mount(modules: ModuleManifest[]): Record<string, CommandDef> {
  return mountModules(modules, connsFor(modules))
}

const list: CommandSpec = {
  path: ['list'],
  effect: 'read',
  description: 'list things',
  args: [],
  examples: [],
  async run() {
    return { ok: true }
  },
}

function mod(name: string, path: string[], shortPath?: string[]): ModuleManifest {
  return {
    name,
    connection: name,
    path,
    ...(shortPath ? { shortPath } : {}),
    description: `${name} module`,
    whenToUse: 'test only',
    configSchema: [],
    commands: [list],
    async status() {
      return { ok: true }
    },
  }
}

describe('mountModules', () => {
  test('mounts a single-segment module at its top-level name', () => {
    const tree = mount([mod('tts', ['tts'])])
    expect(Object.keys(tree)).toEqual(['tts'])
    expect(tree.tts!.subCommands).toHaveProperty('list')
  })

  test('nests a two-segment module under a shared parent', () => {
    const tree = mount([mod('cloudflare-dns', ['cloudflare', 'dns']), mod('cloudflare-r2', ['cloudflare', 'r2'])])

    expect(Object.keys(tree)).toEqual(['cloudflare'])
    const parent = tree.cloudflare!.subCommands as Record<string, { subCommands?: unknown }>
    expect(Object.keys(parent).sort()).toEqual(['dns', 'r2'])
    expect(parent.dns!.subCommands).toHaveProperty('list')
  })

  test('mounts the same module at its shortPath as well', () => {
    const tree = mount([mod('gmail', ['google', 'gmail'], ['gmail'])])

    expect(Object.keys(tree).sort()).toEqual(['gmail', 'google'])
    const nested = (tree.google!.subCommands as Record<string, { subCommands?: unknown }>).gmail!
    expect(nested.subCommands).toHaveProperty('list')
    expect(tree.gmail!.subCommands).toHaveProperty('list')
  })

  test('every module keeps its free configure, status, and skill subcommands at both mounts', () => {
    const tree = mount([mod('gmail', ['google', 'gmail'], ['gmail'])])
    for (const name of ['configure', 'status', 'skill']) {
      expect(tree.gmail!.subCommands).toHaveProperty(name)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/command-mounting.test.ts`
Expected: FAIL — `mountModules` is not exported from `../core/citty`.

- [ ] **Step 3: Write the implementation**

Add to `apps/home/src/core/citty.ts`:

```ts
/**
 * Assemble the root subcommand map by nesting each module's tree under its
 * `path`, and again under `shortPath` when it declares one. Intermediate
 * segments become bare grouping commands shared by every module beneath them,
 * which is what lets `cloudflare dns` and `cloudflare r2` be separate modules.
 */
export function mountModules(
  manifests: ModuleManifest[],
  registered: ConnectionManifest[],
): Record<string, CommandDef> {
  const root: Record<string, CommandDef> = {}

  const mountAt = (segments: string[], tree: CommandDef, manifest: ModuleManifest): void => {
    const [head, ...rest] = segments
    if (head === undefined) return
    if (rest.length === 0) {
      root[head] = tree
      return
    }
    let group = root[head]
    if (!group) {
      group = defineCommand({
        meta: { name: head, description: `${head} commands` },
        subCommands: {},
      })
      root[head] = group
    }
    let cursor = group.subCommands as Record<string, CommandDef>
    for (const segment of rest.slice(0, -1)) {
      let next = cursor[segment]
      if (!next) {
        next = defineCommand({ meta: { name: segment, description: `${segment} commands` }, subCommands: {} })
        cursor[segment] = next
      }
      cursor = next.subCommands as Record<string, CommandDef>
    }
    cursor[rest[rest.length - 1]!] = tree
    void manifest
  }

  for (const manifest of manifests) {
    const tree = buildCommandTree(manifest, registered)
    mountAt(manifest.path, tree, manifest)
    if (manifest.shortPath) mountAt(manifest.shortPath, tree, manifest)
  }

  return root
}
```

In `apps/home/src/index.ts`, replace line 23 with:

```ts
const moduleSubCommands = mountModules(modules, connections)
```

and import `mountModules` alongside `buildCommandTree`, plus `connections` from `./registry`.

- [ ] **Step 4: Update the depth comment**

The comment at `core/citty.ts:86` says both files assume max depth 2. Reword it: `buildCommandTree` still assumes a module's *internal* command paths are at most two segments; `mountModules` handles arbitrary module path depth above that. Keep the pointer to `completion.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS.

- [ ] **Step 6: Verify by hand**

Run: `cd apps/home && bun run dev -- --help` then `bun run dev -- gmail messages list --json`
Expected: the top-level list is unchanged (every module is still single-segment at this point) and gmail still works.

- [ ] **Step 7: Commit**

```bash
git add apps/home/src/core/citty.ts apps/home/src/index.ts apps/home/src/__tests__/command-mounting.test.ts
git commit -m "feat(cli): mount modules by declared path with alias support"
```

---

### Task 3: Completion and skills follow the path

**Files:**
- Modify: `apps/home/src/core/completion.ts:71-130`
- Modify: `apps/home/src/core/skill.ts:10-78`
- Modify: `apps/home/src/__tests__/completion.test.ts`
- Test: `apps/home/src/__tests__/skill-render.test.ts`

**Interfaces:**
- Consumes: `ModuleManifest.path`, `ModuleManifest.shortPath`.
- Produces: `invocationRoot(manifest: ModuleManifest): string[]` exported from `src/core/skill.ts`, returning `shortPath ?? path`.

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/skill-render.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { invocationRoot, renderSkill } from '../core/skill'
import type { CommandSpec, ModuleManifest } from '../core/types'

const messagesList: CommandSpec = {
  path: ['messages', 'list'],
  effect: 'read',
  description: 'List messages',
  args: [{ name: 'q', kind: 'string', description: 'Query' }],
  examples: ['home gmail messages list --q is:unread'],
  async run() {
    return { ok: true }
  },
}

function mod(name: string, path: string[], shortPath?: string[]): ModuleManifest {
  return {
    name,
    connection: 'google',
    path,
    ...(shortPath ? { shortPath } : {}),
    description: `${name} module`,
    whenToUse: 'test only',
    configSchema: [],
    commands: [messagesList],
    async status() {
      return { ok: true }
    },
  }
}

describe('invocationRoot', () => {
  test('prefers shortPath when declared', () => {
    expect(invocationRoot(mod('gmail', ['google', 'gmail'], ['gmail']))).toEqual(['gmail'])
  })

  test('falls back to path', () => {
    expect(invocationRoot(mod('cloudflare-dns', ['cloudflare', 'dns']))).toEqual(['cloudflare', 'dns'])
  })
})

describe('renderSkill', () => {
  test('names the skill after the module, not the path', () => {
    expect(renderSkill(mod('cloudflare-dns', ['cloudflare', 'dns']))).toContain('name: home-cloudflare-dns')
  })

  test('teaches the shortest working invocation', () => {
    const out = renderSkill(mod('gmail', ['google', 'gmail'], ['gmail']))
    expect(out).toContain('`home gmail messages list [args] --json`')
    expect(out).toContain('home gmail status')
    expect(out).toContain('home gmail configure')
  })

  test('uses the full path when there is no shortPath', () => {
    const out = renderSkill(mod('cloudflare-dns', ['cloudflare', 'dns']))
    expect(out).toContain('`home cloudflare dns messages list [args] --json`')
    expect(out).toContain('home cloudflare dns status')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/skill-render.test.ts`
Expected: FAIL — `invocationRoot` is not exported, and `renderSkill` hardcodes `home ${manifest.name}`.

- [ ] **Step 3: Render from the path**

In `apps/home/src/core/skill.ts`, add:

```ts
/** The shortest invocation that works — what a skill should teach. */
export function invocationRoot(manifest: ModuleManifest): string[] {
  return manifest.shortPath ?? manifest.path
}
```

Replace every hardcoded `home ${manifest.name}` in `renderSkill` and `commandInvocation` with `home ${invocationRoot(manifest).join(' ')}`. Leave the skill's `name:` frontmatter and the `home-${manifest.name}` heading keyed to `manifest.name` — a skill is named for its module, not its mount.

- [ ] **Step 4: Complete on the mounted tree**

`moduleNode` in `apps/home/src/core/completion.ts` hardcodes `[manifest.name]` as its node prefix, and `buildCompletionTree` registers it at `m.name` (line 122). Give `moduleNode` the mount it is being built for, then nest — mirroring `mountModules`.

Change the signature to `function moduleNode(manifest: ModuleManifest, mount: string[]): CompletionNode` and replace every `[manifest.name]` / `[manifest.name, x]` inside it with `mount` / `[...mount, x]`. The `home-${manifest.name}` skill description on line 82 stays keyed to the name — a skill is named for its module, not its mount.

Then in `buildCompletionTree`, replace the loop at lines 121-123:

```ts
  const mountNode = (segments: string[], node: CompletionNode): void => {
    let cursor = root
    for (const segment of segments.slice(0, -1)) {
      let next = cursor.subcommands.get(segment)
      if (!next) {
        next = newNode([segment], `${segment} commands`)
        cursor.subcommands.set(segment, next)
      }
      cursor = next
    }
    cursor.subcommands.set(segments[segments.length - 1]!, node)
  }

  for (const m of manifests) {
    mountNode(m.path, moduleNode(m, m.path))
    if (m.shortPath) mountNode(m.shortPath, moduleNode(m, m.shortPath))
  }
```

A module mounted twice gets two nodes rather than one shared one, because each node's leaves carry their own fully-qualified path for completion display.

Update the sync comment at line 87 to match the reworded one in `citty.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/core/skill.ts apps/home/src/core/completion.ts apps/home/src/__tests__/skill-render.test.ts apps/home/src/__tests__/completion.test.ts
git commit -m "feat(core): completion and skills render from the module path"
```

---

### Task 4: Nest the Google modules and reinstall

**Files:**
- Modify: `apps/home/src/modules/gmail/index.ts`, `apps/home/src/modules/gdrive/index.ts`, `apps/home/src/modules/gcal/index.ts`
- Modify: `apps/home/src/__tests__/registry-invariants.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-3.

- [ ] **Step 1: Write the failing test**

Add to `apps/home/src/__tests__/registry-invariants.test.ts`:

```ts
test('the google modules nest under google and keep a top-level alias', () => {
  const byName = Object.fromEntries(modules.map((m) => [m.name, m] as const))
  for (const name of ['gmail', 'gdrive', 'gcal']) {
    expect(byName[name]!.path).toEqual(['google', name])
    expect(byName[name]!.shortPath).toEqual([name])
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/registry-invariants.test.ts`
Expected: FAIL — each path is still `['gmail']` and no `shortPath` is set.

- [ ] **Step 3: Nest them**

In each of the three manifests, change `path` and add `shortPath`:

```ts
  path: ['google', 'gmail'],
  shortPath: ['gmail'],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS, including `duplicate_path` staying clean.

- [ ] **Step 5: Verify both mounts**

Run:
```bash
cd apps/home
bun run dev -- gmail messages list --q is:unread --json
bun run dev -- google gmail messages list --q is:unread --json
```
Expected: identical output from both.

- [ ] **Step 6: Rebuild and reinstall skills**

Run: `cd apps/home && bun run build:install && home skill install`
Expected: `home-gmail`, `home-gdrive`, `home-gcal` regenerate with `home gmail …` invocations. Skill names are unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/home/src
git commit -m "feat(google): nest gmail, gdrive, and gcal under google with top-level aliases"
```

---

### Task 5: Update the spec

**Files:**
- Modify: `docs/specs/005-MODULE-SYSTEM.md`

- [ ] **Step 1: Drop the landed markers**

Unwrap the `PLANNED — 008-MODULE-PATHS-AND-ALIASES` blockquote in *Two levels of nesting, and the tree assumes it* in `docs/specs/005-MODULE-SYSTEM.md`, and delete the sentence above it stating that a module mounts at its `name`. Update the *Completion is a second tree over the same manifests* section to describe mounting by path.

- [ ] **Step 2: Update the frontmatter**

Change `plans:` to `[]`. Every plan the spec named has now landed.

- [ ] **Step 3: Append the Landed section**

Add to the bottom of this plan:

```markdown
## Landed

**Date:** <YYYY-MM-DD>
**Commits:** <first>..<last>

**Verified:** `bun test` and `bun run typecheck` clean; `home gmail messages list` and
`home google gmail messages list` produce identical output; `home skill install`
regenerates `home-gmail` teaching the short form; shell completion offers `google`
and `gmail` at the root.

**Corrections:** <anything the work proved wrong about this plan, or "none">
```

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs(home): mark module paths and aliases landed"
```
