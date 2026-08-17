---
spec: 005-MODULE-SYSTEM
---

# Connection Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split credential ownership out of `ModuleManifest` into a first-class `ConnectionManifest`, and chain config resolution, `configure`, and `status` through it.

**Architecture:** A connection declares the credentials common to everything behind it; a module declares its capability surface and names one connection. Connections and modules share one config/secrets namespace keyed by name, so no stored value moves on disk — two readers pick disjoint keys out of the same file. The connection is invisible to the CLI: it contributes no command and no path segment.

**Tech Stack:** TypeScript, Bun (runtime, test runner, bundler), citty (command tree), consola (prompts/logging), Biome (lint/format).

## Global Constraints

- Bun ≥ 1.3.0. Never `node`, `npm`, `pnpm`, `yarn`.
- TypeScript only. No `.js` files, including config and scripts.
- Run tests with `bun test` from `apps/home`. The full suite is `bun run test` (wraps `scripts/test-isolated.sh`).
- Type check with `bun run typecheck` (`tsc --noEmit`).
- Tests live in `apps/home/src/__tests__/<name>.test.ts`, use `bun:test` (`describe`/`test`/`expect`), and get an isolated `XDG_CONFIG_HOME` from the `setup.ts` preload.
- Config store, secrets namespace, invariants, and the configure/status chains are specified in [`005-MODULE-SYSTEM`](../specs/005-MODULE-SYSTEM.md). Cite it; do not restate it.
- Overlaps [`005-SCHEMA-OUTPUT`](005-SCHEMA-OUTPUT.md), which is approved and may land first. That plan adds `out` to `RunResult` **and an `outputs` thunk to `ModuleManifest`** in `src/core/types.ts`, plus `--format` to `globalFlags` and a rewritten `emit()` path in `src/core/citty.ts`. The two are independent in substance — different fields, different functions — but they edit the same two files and both touch `makeUserLeaf`. Land one fully before starting the other, and expect the second to rebase through the first.
- Do not run `bun run build:install` or `home skill install` during this plan — no user-visible command paths change here. Both belong to [`008-MODULE-PATHS-AND-ALIASES`](008-MODULE-PATHS-AND-ALIASES.md).

---

### Task 1: Connection types and pure resolution helpers

**Files:**
- Modify: `apps/home/src/core/types.ts`
- Create: `apps/home/src/core/connections.ts`
- Test: `apps/home/src/__tests__/connections.test.ts`

**Interfaces:**
- Consumes: `ConfigField`, `ModuleConfig`, `RunResult`, `ModuleManifest` from `src/core/types.ts`.
- Produces:
  - `interface ConnectionManifest { name: string; description: string; configSchema: ConfigField[]; configure?: () => Promise<void>; status(cfg: ModuleConfig): Promise<RunResult> }`
  - `ModuleManifest.connection?: string` (made required in Task 7)
  - `connectionFor(module: Pick<ModuleManifest, 'name' | 'connection'>, connections: ConnectionManifest[]): ConnectionManifest | null`
  - `mergeConfig(connectionCfg: ModuleConfig | null, moduleCfg: ModuleConfig | null): ModuleConfig | null`
  - `validateRegistry(connections: ConnectionManifest[], modules: ModuleManifest[]): RegistryViolation[]`
  - `interface RegistryViolation { kind: 'unknown_connection' | 'duplicate_module' | 'duplicate_connection' | 'unpaired_name' | 'key_collision'; detail: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/connections.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { connectionFor, mergeConfig, validateRegistry } from '../core/connections'
import type { ConnectionManifest, ModuleManifest } from '../core/types'

function conn(name: string, keys: string[] = []): ConnectionManifest {
  return {
    name,
    description: `${name} test connection`,
    configSchema: keys.map((key) => ({ key, label: key, kind: 'string' as const })),
    async status() {
      return { ok: true }
    },
  }
}

function mod(name: string, connection: string, keys: string[] = []): ModuleManifest {
  return {
    name,
    connection,
    description: `${name} test module`,
    whenToUse: 'test only',
    configSchema: keys.map((key) => ({ key, label: key, kind: 'string' as const })),
    commands: [],
    async status() {
      return { ok: true }
    },
  }
}

describe('connectionFor', () => {
  test('resolves a module to its connection', () => {
    const connections = [conn('google'), conn('unifi')]
    expect(connectionFor(mod('gmail', 'google'), connections)?.name).toBe('google')
  })

  test('returns null for an unregistered connection', () => {
    expect(connectionFor(mod('gmail', 'nope'), [conn('google')])).toBeNull()
  })
})

describe('mergeConfig', () => {
  test('module keys win over connection keys', () => {
    expect(mergeConfig({ url: 'conn', shared: 'yes' }, { url: 'mod' })).toEqual({ url: 'mod', shared: 'yes' })
  })

  test('returns null only when both halves are absent', () => {
    expect(mergeConfig(null, null)).toBeNull()
    expect(mergeConfig({ url: 'conn' }, null)).toEqual({ url: 'conn' })
    expect(mergeConfig(null, { site: 'default' })).toEqual({ site: 'default' })
  })
})

describe('validateRegistry', () => {
  test('accepts a matched pair sharing a name with disjoint keys', () => {
    const connections = [conn('unifi', ['url', 'apiKey'])]
    const modules = [mod('unifi', 'unifi', ['site'])]
    expect(validateRegistry(connections, modules)).toEqual([])
  })

  test('flags a module naming an unregistered connection', () => {
    const violations = validateRegistry([conn('google')], [mod('gmail', 'cloudflare')])
    expect(violations).toEqual([
      { kind: 'unknown_connection', detail: 'module "gmail" names unknown connection "cloudflare"' },
    ])
  })

  test('flags a shared name that is not a matched pair', () => {
    const violations = validateRegistry([conn('unifi')], [mod('unifi', 'google'), mod('gmail', 'google')])
    expect(violations.map((v) => v.kind)).toContain('unknown_connection')
    expect(violations.map((v) => v.kind)).toContain('unpaired_name')
  })

  test('flags config keys shared between a module and its connection', () => {
    const violations = validateRegistry([conn('unifi', ['url'])], [mod('unifi', 'unifi', ['url', 'site'])])
    expect(violations).toEqual([
      { kind: 'key_collision', detail: 'module "unifi" and connection "unifi" both declare config key "url"' },
    ])
  })

  test('flags duplicate module and connection names', () => {
    const violations = validateRegistry([conn('a'), conn('a')], [mod('b', 'a'), mod('b', 'a')])
    expect(violations.map((v) => v.kind).sort()).toEqual(['duplicate_connection', 'duplicate_module'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/connections.test.ts`
Expected: FAIL — `Cannot find module '../core/connections'`

- [ ] **Step 3: Add the types**

In `apps/home/src/core/types.ts`, add after the `ModuleManifest` interface:

```ts
/**
 * The credentials for reaching an external system. Invisible to the CLI: a
 * connection contributes no command and no path segment. The authenticated
 * client it produces is a plain typed export beside it, not a manifest field —
 * threading a client type through the registry array would make every consumer
 * generic for no gain.
 */
export interface ConnectionManifest {
  name: string
  description: string
  configSchema: ConfigField[]
  /** Replaces the generic prompt loop for setup that is not typed answers. */
  configure?: () => Promise<void>
  status(cfg: ModuleConfig): Promise<RunResult>
}
```

And add to `ModuleManifest`, directly under `name`:

```ts
  /**
   * The connection supplying this module's credentials. Optional only until
   * every module declares one (plan 006, task 7); treat it as required.
   */
  connection?: string
```

- [ ] **Step 4: Write the implementation**

Create `apps/home/src/core/connections.ts`:

```ts
import type { ConnectionManifest, ModuleConfig, ModuleManifest } from './types'

export function connectionFor(
  module: Pick<ModuleManifest, 'name' | 'connection'>,
  connections: ConnectionManifest[],
): ConnectionManifest | null {
  return connections.find((c) => c.name === module.connection) ?? null
}

/**
 * The connection's stored values overlaid with the module's own. Commands read
 * one flat `ctx.config`, which is why moving a field up to a connection changes
 * no command body. Null only when neither half has been configured — the
 * caller distinguishes "unconfigured" from "configured but empty".
 */
export function mergeConfig(
  connectionCfg: ModuleConfig | null,
  moduleCfg: ModuleConfig | null,
): ModuleConfig | null {
  if (connectionCfg === null && moduleCfg === null) return null
  return { ...(connectionCfg ?? {}), ...(moduleCfg ?? {}) }
}

export interface RegistryViolation {
  kind: 'unknown_connection' | 'duplicate_module' | 'duplicate_connection' | 'unpaired_name' | 'key_collision'
  detail: string
}

function duplicates(names: string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) dupes.add(name)
    seen.add(name)
  }
  return [...dupes]
}

export function validateRegistry(
  connections: ConnectionManifest[],
  modules: ModuleManifest[],
): RegistryViolation[] {
  const out: RegistryViolation[] = []

  for (const name of duplicates(connections.map((c) => c.name))) {
    out.push({ kind: 'duplicate_connection', detail: `connection "${name}" is registered more than once` })
  }
  for (const name of duplicates(modules.map((m) => m.name))) {
    out.push({ kind: 'duplicate_module', detail: `module "${name}" is registered more than once` })
  }

  const connectionNames = new Set(connections.map((c) => c.name))
  for (const module of modules) {
    if (!connectionNames.has(module.connection ?? '')) {
      out.push({
        kind: 'unknown_connection',
        detail: `module "${module.name}" names unknown connection "${module.connection}"`,
      })
      continue
    }
    // A shared name means one config file and one secrets prefix serve both, so
    // it is only safe when they are the same unit seen from two sides.
    if (connectionNames.has(module.name) && module.connection !== module.name) {
      out.push({
        kind: 'unpaired_name',
        detail: `module "${module.name}" shares a name with a connection it does not use`,
      })
    }
    const connection = connections.find((c) => c.name === module.connection)!
    const connectionKeys = new Set(connection.configSchema.map((f) => f.key))
    for (const field of module.configSchema) {
      if (connectionKeys.has(field.key)) {
        out.push({
          kind: 'key_collision',
          detail: `module "${module.name}" and connection "${connection.name}" both declare config key "${field.key}"`,
        })
      }
    }
  }

  return out
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test src/__tests__/connections.test.ts && bun run typecheck`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/core/types.ts apps/home/src/core/connections.ts apps/home/src/__tests__/connections.test.ts
git commit -m "feat(core): add ConnectionManifest and registry resolution helpers"
```

---

### Task 2: Connection registry with the first real connection

**Files:**
- Create: `apps/home/src/connections/tts/index.ts`
- Modify: `apps/home/src/modules/tts/index.ts`
- Modify: `apps/home/src/registry.ts`
- Test: `apps/home/src/__tests__/registry-invariants.test.ts`

**Interfaces:**
- Consumes: `validateRegistry` from Task 1.
- Produces: `connections: ConnectionManifest[]` and `connectionByName: Record<string, ConnectionManifest>` exported from `src/registry.ts`.

`tts` goes first because its `configSchema` is empty, so the conversion exercises registration without also moving stored values.

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/registry-invariants.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { validateRegistry } from '../core/connections'
import { connections, modules } from '../registry'

describe('registry invariants', () => {
  test('the real registry has no violations', () => {
    expect(validateRegistry(connections, modules)).toEqual([])
  })

  test('every registered connection backs at least one module', () => {
    const used = new Set(modules.map((m) => m.connection))
    expect(connections.filter((c) => !used.has(c.name)).map((c) => c.name)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/registry-invariants.test.ts`
Expected: FAIL — `connections` is not exported from `../registry`.

- [ ] **Step 3: Create the tts connection**

Create `apps/home/src/connections/tts/index.ts`:

```ts
import type { ConnectionManifest } from '../../core/types'
import { pingProvider, readTtsConfig } from '../../modules/tts/client'

export const connection: ConnectionManifest = {
  name: 'tts',
  description: 'Local speech synthesis provider',
  configSchema: [],
  async status(cfg) {
    try {
      const ttsCfg = readTtsConfig(cfg)
      await pingProvider(ttsCfg)
      return { ok: true, data: { provider: ttsCfg.provider } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default connection
```

- [ ] **Step 4: Point the tts module at it**

In `apps/home/src/modules/tts/index.ts`, add `connection: 'tts',` directly under `name: 'tts',`.

- [ ] **Step 5: Register connections**

Rewrite `apps/home/src/registry.ts` to add the connections array alongside the existing modules array. Keep every existing module import and the `modules` / `moduleByName` exports exactly as they are, and add:

```ts
import type { ConnectionManifest } from './core/types'
import ttsConnection from './connections/tts'

export const connections: ConnectionManifest[] = [ttsConnection]

export const connectionByName: Record<string, ConnectionManifest> = Object.fromEntries(
  connections.map((c) => [c.name, c] as const),
)
```

- [ ] **Step 6: Run tests to verify the shape**

Run: `cd apps/home && bun test src/__tests__/registry-invariants.test.ts`
Expected: FAIL on the first test with 16 `unknown_connection` violations — every module except `tts` still has no `connection`. This is the expected intermediate state; Task 7 closes it.

Temporarily narrow the first test to the converted set so the suite stays green until Task 7:

```ts
  test('the real registry has no violations', () => {
    // Widened to the whole registry in plan 006, task 7.
    const converted = modules.filter((m) => m.connection !== undefined)
    expect(validateRegistry(connections, converted)).toEqual([])
  })
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/home && bun test src/__tests__/registry-invariants.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/home/src/connections apps/home/src/registry.ts apps/home/src/modules/tts/index.ts apps/home/src/__tests__/registry-invariants.test.ts
git commit -m "feat(core): add connection registry with tts as the first connection"
```

---

### Task 3: Chain config resolution, and fix the unguarded not-configured path

**Files:**
- Modify: `apps/home/src/core/citty.ts:72-85` (`resolveModuleConfig`), `:108-118`, `:183-193`
- Test: `apps/home/src/__tests__/config-resolution.test.ts`

**Interfaces:**
- Consumes: `mergeConfig`, `connectionFor` from Task 1; `connections` from Task 2.
- Produces: `resolveModuleConfig(manifest: ModuleManifest): ModuleConfig | null` now returning the merged connection+module view.

`makeUserLeaf` and `makeStatusCommand` currently emit the not-configured error and then fall through and run the command anyway against an empty config. Fix that here — it is in the function this task rewrites, and a chained resolution makes the fall-through reachable more often.

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/config-resolution.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveModuleConfig } from '../core/citty'
import { saveModuleConfig } from '../core/config'
import type { ConnectionManifest, ModuleManifest } from '../core/types'

const original = process.env.XDG_CONFIG_HOME
afterEach(() => {
  process.env.XDG_CONFIG_HOME = original
})

function isolate(): void {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'home-cfg-'))
}

const testConnection: ConnectionManifest = {
  name: 'testconn',
  description: 'test',
  configSchema: [{ key: 'url', label: 'URL', kind: 'string', required: true }],
  async status() {
    return { ok: true }
  },
}

const testModule: ModuleManifest = {
  name: 'testmod',
  connection: 'testconn',
  description: 'test',
  whenToUse: 'test only',
  configSchema: [{ key: 'site', label: 'Site', kind: 'string' }],
  commands: [],
  async status() {
    return { ok: true }
  },
}

describe('resolveModuleConfig', () => {
  test('merges the connection half with the module half', () => {
    isolate()
    saveModuleConfig('testconn', { $schemaVersion: 1, url: 'https://gw.example' })
    saveModuleConfig('testmod', { $schemaVersion: 1, site: 'default' })

    expect(resolveModuleConfig(testModule, [testConnection])).toEqual({
      url: 'https://gw.example',
      site: 'default',
    })
  })

  test('returns the connection half when the module has stored nothing', () => {
    isolate()
    saveModuleConfig('testconn', { $schemaVersion: 1, url: 'https://gw.example' })

    expect(resolveModuleConfig(testModule, [testConnection])).toEqual({ url: 'https://gw.example' })
  })

  test('returns null when neither half is configured', () => {
    isolate()
    expect(resolveModuleConfig(testModule, [testConnection])).toBeNull()
  })

  test('resolves a module whose connection shares its name from one file', () => {
    isolate()
    const paired: ConnectionManifest = { ...testConnection, name: 'unifi' }
    const mod: ModuleManifest = { ...testModule, name: 'unifi', connection: 'unifi' }
    saveModuleConfig('unifi', { $schemaVersion: 1, url: 'https://c.example', site: 'default' })

    expect(resolveModuleConfig(mod, [paired])).toEqual({ url: 'https://c.example', site: 'default' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/config-resolution.test.ts`
Expected: FAIL — `resolveModuleConfig` takes one argument and returns only the module's own config.

- [ ] **Step 3: Rewrite resolveModuleConfig**

In `apps/home/src/core/citty.ts`, replace the existing `resolveModuleConfig` (lines 72-85) with:

```ts
function readStoredConfig(name: string, schema: ConfigField[]): ModuleConfig | null {
  const raw = loadModuleConfig(name)
  const secrets: ModuleConfig = {}
  for (const field of schema) {
    if (field.kind !== 'secret') continue
    const secret = getSecret(name, field.key)
    if (secret !== null) secrets[field.key] = secret
  }
  if (!raw) return Object.keys(secrets).length > 0 ? secrets : null
  const { $schemaVersion: _drop, ...rest } = raw
  void _drop
  return { ...rest, ...secrets }
}

export function resolveModuleConfig(
  manifest: ModuleManifest,
  registered: ConnectionManifest[],
): ModuleConfig | null {
  const connection = connectionFor(manifest, registered)
  const moduleCfg = readStoredConfig(manifest.name, manifest.configSchema)
  if (!connection) return moduleCfg
  // A matched pair reads one file; reading it twice and merging is a no-op,
  // and keeping the paths identical avoids a branch that only the paired case
  // would ever exercise.
  const connectionCfg = readStoredConfig(connection.name, connection.configSchema)
  return mergeConfig(connectionCfg, moduleCfg)
}
```

Add the imports at the top of `citty.ts`:

```ts
import type { ConfigField, ConnectionManifest } from './types'
import { connectionFor, mergeConfig } from './connections'
```

**Do not import `connections` from `../registry` here.** `registry.ts` reaches `core/citty.ts` through `modules/vercel/sync.ts`, so that import closes a cycle. The connection list is threaded in from the caller instead: make `registered` a required parameter, thread it through `buildCommandTree(manifest, registered)` into `makeUserLeaf`, `makeStatusCommand`, and `makeConfigureCommand`, and have `src/index.ts` pass `connections` at the one place that already imports the registry.

Update the four existing callers — `src/commands/status.ts:2`, `src/commands/overview.ts:2`, `src/commands/doctor.ts:2`, and `src/modules/vercel/sync.ts:2` — to pass `connections`. All four already import from the registry except `sync.ts`, which must import it lazily inside `collectLocal` for the same cycle reason.

Note: `readStoredConfig` now returns keyring secrets even when no config file exists. That is what makes a browser-authorized module such as `gmail` — which persists nothing but a `refreshToken` secret — resolve as configured.

- [ ] **Step 4: Guard the not-configured path**

In `makeUserLeaf`, the `if (!config && requiresConfig)` block emits and then falls through. Add `return` after the `emit`:

```ts
      if (!config && requiresConfig) {
        await emit(
          {
            ok: false,
            kind: 'config',
            message: `module "${manifest.name}" is not configured — run \`home ${manifest.name} configure\``,
            code: 'not_configured',
          },
          { json: env.json },
        )
        return
      }
```

Apply the same `return` to the matching block in `makeStatusCommand`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS. `vercel-sync.test.ts` exercises `resolveModuleConfig`; if it fails, the cause is the new secrets-without-config-file behavior — update the fixture, not the implementation.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/core/citty.ts apps/home/src/__tests__/config-resolution.test.ts
git commit -m "feat(core): resolve module config through its connection; guard unconfigured commands"
```

---

### Task 4: Configure walks the chain

**Files:**
- Modify: `apps/home/src/core/configure.ts:197-274`
- Modify: `apps/home/src/core/citty.ts` (`makeConfigureCommand`)
- Test: `apps/home/src/__tests__/configure-chain.test.ts`

**Interfaces:**
- Consumes: `connectionFor` (Task 1), `connections` (Task 2).
- Produces:
  - `interface Configurable { name: string; configSchema: ConfigField[]; configure?: () => Promise<void> }`
  - `runConfigure(target: Configurable, opts?: ConfigureOpts): Promise<void>` — widened from `ModuleManifest`
  - `configureRunnerFor(target: Configurable): (opts?: ConfigureOpts) => Promise<void>` — widened
  - `connectionNeedsSetup(connection: ConnectionManifest): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/configure-chain.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectionNeedsSetup } from '../core/configure'
import { saveModuleConfig } from '../core/config'
import { setSecret } from '../core/secrets'
import type { ConnectionManifest } from '../core/types'

const original = process.env.XDG_CONFIG_HOME
afterEach(() => {
  process.env.XDG_CONFIG_HOME = original
})

function isolate(): void {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'home-conf-'))
}

function connection(schema: ConnectionManifest['configSchema']): ConnectionManifest {
  return {
    name: 'chainconn',
    description: 'test',
    configSchema: schema,
    async status() {
      return { ok: true }
    },
  }
}

describe('connectionNeedsSetup', () => {
  test('false when the connection declares no required fields', () => {
    isolate()
    expect(connectionNeedsSetup(connection([]))).toBe(false)
  })

  test('true when a required plain field has no stored value', () => {
    isolate()
    expect(connectionNeedsSetup(connection([{ key: 'url', label: 'URL', kind: 'url', required: true }]))).toBe(true)
  })

  test('false once every required plain field is stored', () => {
    isolate()
    saveModuleConfig('chainconn', { $schemaVersion: 1, url: 'https://x.example' })
    expect(connectionNeedsSetup(connection([{ key: 'url', label: 'URL', kind: 'url', required: true }]))).toBe(false)
  })

  test('true when a required secret is absent, false once it is stored', () => {
    isolate()
    const schema = [{ key: 'token', label: 'Token', kind: 'secret' as const, required: true }]
    expect(connectionNeedsSetup(connection(schema))).toBe(true)
    setSecret('chainconn', 'token', 'abc123')
    expect(connectionNeedsSetup(connection(schema))).toBe(false)
  })

  test('ignores optional fields', () => {
    isolate()
    expect(connectionNeedsSetup(connection([{ key: 'note', label: 'Note', kind: 'string' }]))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/configure-chain.test.ts`
Expected: FAIL — `connectionNeedsSetup` is not exported from `../core/configure`.

- [ ] **Step 3: Widen the configure target and add the readiness check**

In `apps/home/src/core/configure.ts`, add near the top:

```ts
import type { ConnectionManifest } from './types'

/**
 * Anything the prompt loop can configure. Both `ModuleManifest` and
 * `ConnectionManifest` satisfy it structurally, so the loop needs no branch.
 */
export interface Configurable {
  name: string
  configSchema: ConfigField[]
  configure?: () => Promise<void>
}

/**
 * Whether a connection still has required fields with no stored value. Drives
 * the chain: `home <module> configure` sets the connection up first, so a
 * module's setup never fails on a credential the user was not asked for.
 */
export function connectionNeedsSetup(connection: ConnectionManifest): boolean {
  const stored = loadModuleConfig(connection.name)
  return connection.configSchema.some((field) => {
    if (!field.required) return false
    if (field.kind === 'secret') return getSecret(connection.name, field.key) === null
    return stored?.[field.key] === undefined
  })
}
```

Then change the two signatures at the bottom of the file from `ModuleManifest` to `Configurable`:

```ts
export async function runConfigure(target: Configurable, opts: ConfigureOpts = {}): Promise<void> {
```

```ts
export function configureRunnerFor(target: Configurable): (opts?: ConfigureOpts) => Promise<void> {
  if (target.configure) return () => target.configure!()
  return (opts: ConfigureOpts = {}) => runConfigure(target, opts)
}
```

Rename the local `manifest` references inside `runConfigure` to `target`. Drop the now-unused `ModuleManifest` import if nothing else in the file uses it.

- [ ] **Step 4: Chain the configure command**

In `apps/home/src/core/citty.ts`, replace the body of `makeConfigureCommand`'s `run` with:

```ts
    async run({ args }) {
      const raw = args as Record<string, unknown>
      const env = ctxFromArgs(raw)
      const opts = { rotate: Boolean(raw.rotate), force: Boolean(raw.force) }
      try {
        const connection = connectionFor(manifest, registered)
        if (connection && (opts.force || connectionNeedsSetup(connection))) {
          consola.info(`— ${connection.name} connection —`)
          await configureRunnerFor(connection)(opts)
        }
        await configureRunnerFor(manifest)(opts)
        await emit({ ok: true, data: `${manifest.name}: configured` }, { json: env.json })
      } catch (err) {
        await emit(
          {
            ok: false,
            kind: 'user',
            message: (err as Error).message,
            code: (err as { code?: string }).code ?? 'configure_failed',
          },
          { json: env.json },
        )
      }
    },
```

`registered` is the `ConnectionManifest[]` threaded into `makeConfigureCommand` by `buildCommandTree` in Task 3. Add `import { consola } from 'consola'` and extend the existing configure import to `import { configureRunnerFor, connectionNeedsSetup } from './configure'`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS. `configure-seam.test.ts` covers `configureRunnerFor`; the widened signature is source-compatible with it.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/core/configure.ts apps/home/src/core/citty.ts apps/home/src/__tests__/configure-chain.test.ts
git commit -m "feat(core): configure walks the connection chain before the module"
```

---

### Task 5: Status walks the chain and groups by connection

**Files:**
- Modify: `apps/home/src/core/status.ts`
- Modify: `apps/home/src/core/status-view.ts`
- Modify: `apps/home/src/core/citty.ts` (`makeStatusCommand`)
- Modify: `apps/home/src/commands/status.ts`
- Modify: `apps/home/src/__tests__/status.test.ts`
- Modify: `apps/home/src/__tests__/status-view.test.ts`

**Interfaces:**
- Consumes: `connectionFor` (Task 1), `connections` (Task 2), `resolveModuleConfig` (Task 3).
- Produces:
  - `interface ConnectionStatusReport { connection: string; status: ModuleStatusState; data?: unknown; message?: string; code?: string; modules: ModuleStatusReport[] }`
  - `RootStatusReport` gains `connections: ConnectionStatusReport[]` and drops the flat `modules` array.
  - `ModuleStatusReport` gains `connection: string`.
  - `collectStatuses(connections: ConnectionManifest[], modules: ModuleManifest[], resolveConfig: ModuleConfigResolver, resolveConnectionConfig: ConnectionConfigResolver): Promise<RootStatusReport>`
  - `type ConnectionConfigResolver = (connection: ConnectionManifest) => ModuleConfig | null`

- [ ] **Step 1: Write the failing test**

Replace the contents of `apps/home/src/__tests__/status.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { collectStatuses, type ConnectionConfigResolver, type ModuleConfigResolver } from '../core/status'
import type { ConnectionManifest, ModuleManifest, RunResult } from '../core/types'

function conn(name: string, status: ConnectionManifest['status']): ConnectionManifest {
  return { name, description: `${name} connection`, configSchema: [], status }
}

function mod(name: string, connection: string, status: ModuleManifest['status']): ModuleManifest {
  return {
    name,
    connection,
    description: `${name} test module`,
    whenToUse: 'test only',
    configSchema: [{ key: 'token', label: 'Token', kind: 'secret', required: true }],
    commands: [],
    status,
  }
}

const ok = async (): Promise<RunResult> => ({ ok: true })

describe('root status collector', () => {
  test('groups modules under their connection and counts modules only', async () => {
    const connections = [
      conn('google', async () => ({ ok: true, data: { clientId: 'x' } })),
      conn('kuma', async () => ({ ok: true })),
    ]
    const modules = [
      mod('gmail', 'google', async () => ({ ok: true, data: { latencyMs: 12 } })),
      mod('gdrive', 'google', ok),
      mod('uptime-kuma', 'kuma', async () => ({ ok: false, kind: 'system', message: 'offline', code: 'offline' })),
    ]
    const resolve: ModuleConfigResolver = () => ({ token: 'test' })
    const resolveConnection: ConnectionConfigResolver = () => ({})

    const report = await collectStatuses(connections, modules, resolve, resolveConnection)

    expect(report.status).toBe('degraded')
    expect(report.summary).toEqual({ ok: 2, error: 1, notConfigured: 0 })
    expect(report.connections.map((c) => c.connection)).toEqual(['google', 'kuma'])
    expect(report.connections[0]!.modules.map((m) => m.module)).toEqual(['gmail', 'gdrive'])
    expect(report.connections[0]!.modules[0]).toEqual({
      module: 'gmail',
      connection: 'google',
      configured: true,
      status: 'ok',
      data: { latencyMs: 12 },
    })
  })

  test('probes a shared connection once', async () => {
    let probes = 0
    const connections = [
      conn('google', async () => {
        probes++
        return { ok: true }
      }),
    ]
    const modules = [mod('gmail', 'google', ok), mod('gdrive', 'google', ok), mod('gcal', 'google', ok)]

    await collectStatuses(connections, modules, () => ({ token: 't' }), () => ({}))

    expect(probes).toBe(1)
  })

  test('a failing connection short-circuits its modules without probing them', async () => {
    let moduleProbes = 0
    const connections = [
      conn('google', async () => ({ ok: false, kind: 'config', message: 'no client', code: 'not_configured' })),
    ]
    const modules = [
      mod('gmail', 'google', async () => {
        moduleProbes++
        return { ok: true }
      }),
    ]

    const report = await collectStatuses(connections, modules, () => ({ token: 't' }), () => ({}))

    expect(moduleProbes).toBe(0)
    expect(report.connections[0]!.status).toBe('not_configured')
    expect(report.connections[0]!.modules[0]).toMatchObject({
      module: 'gmail',
      status: 'not_configured',
      code: 'connection_unavailable',
    })
    expect(report.connections[0]!.modules[0]!.message).toContain('google')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/status.test.ts`
Expected: FAIL — `collectStatuses` is not exported from `../core/status`.

- [ ] **Step 3: Rewrite the collector**

Replace `apps/home/src/core/status.ts` with:

```ts
import type { ConnectionManifest, ModuleConfig, ModuleManifest, RunResult } from './types'

export type ModuleStatusState = 'ok' | 'error' | 'not_configured'
export type RootStatusState = 'ok' | 'degraded' | 'not_configured'

export interface ModuleStatusReport {
  module: string
  connection: string
  configured: boolean
  status: ModuleStatusState
  data?: unknown
  message?: string
  code?: string
}

export interface ConnectionStatusReport {
  connection: string
  status: ModuleStatusState
  data?: unknown
  message?: string
  code?: string
  modules: ModuleStatusReport[]
}

export interface RootStatusReport {
  status: RootStatusState
  summary: { ok: number; error: number; notConfigured: number }
  connections: ConnectionStatusReport[]
}

export type ModuleConfigResolver = (manifest: ModuleManifest) => ModuleConfig | null
export type ConnectionConfigResolver = (connection: ConnectionManifest) => ModuleConfig | null

function stateFor(result: RunResult): ModuleStatusState {
  if (result.ok) return 'ok'
  return result.code === 'not_configured' ? 'not_configured' : 'error'
}

async function probe(run: () => Promise<RunResult>): Promise<RunResult> {
  try {
    return await run()
  } catch (err) {
    return { ok: false, kind: 'system', message: err instanceof Error ? err.message : String(err), code: 'status_failed' }
  }
}

async function collectConnection(
  connection: ConnectionManifest,
  resolveConnectionConfig: ConnectionConfigResolver,
): Promise<Omit<ConnectionStatusReport, 'modules'>> {
  let cfg: ModuleConfig | null
  try {
    cfg = resolveConnectionConfig(connection)
  } catch (err) {
    return {
      connection: connection.name,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
      code: 'config_failed',
    }
  }
  const result = await probe(() => connection.status(cfg ?? {}))
  if (result.ok) {
    return {
      connection: connection.name,
      status: 'ok',
      ...(result.data === undefined ? {} : { data: result.data }),
    }
  }
  return {
    connection: connection.name,
    status: stateFor(result),
    message: result.message,
    ...(result.code === undefined ? {} : { code: result.code }),
  }
}

async function collectModule(
  manifest: ModuleManifest,
  resolveConfig: ModuleConfigResolver,
): Promise<ModuleStatusReport> {
  const connection = manifest.connection ?? manifest.name
  const requiresConfig = manifest.requiresConfig ?? manifest.configSchema.length > 0
  let config: ModuleConfig | null

  try {
    config = resolveConfig(manifest)
  } catch (err) {
    return {
      module: manifest.name,
      connection,
      configured: false,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
      code: 'config_failed',
    }
  }

  if (!config && requiresConfig) {
    return { module: manifest.name, connection, configured: false, status: 'not_configured' }
  }

  const result = await probe(() => manifest.status(config ?? {}))
  if (result.ok) {
    return {
      module: manifest.name,
      connection,
      configured: config !== null,
      status: 'ok',
      ...(result.data === undefined ? {} : { data: result.data }),
    }
  }
  return {
    module: manifest.name,
    connection,
    configured: config !== null,
    status: stateFor(result),
    message: result.message,
    ...(result.code === undefined ? {} : { code: result.code }),
  }
}

/**
 * Probe every connection once, then every module whose connection came back
 * healthy. A module riding a broken connection reports the connection's remedy
 * rather than the downstream symptom — running its probe would produce a
 * misleading error naming the wrong subject.
 */
export async function collectStatuses(
  connections: ConnectionManifest[],
  modules: ModuleManifest[],
  resolveConfig: ModuleConfigResolver,
  resolveConnectionConfig: ConnectionConfigResolver,
): Promise<RootStatusReport> {
  const grouped = await Promise.all(
    connections.map(async (connection) => {
      const head = await collectConnection(connection, resolveConnectionConfig)
      const own = modules.filter((m) => (m.connection ?? m.name) === connection.name)
      if (head.status !== 'ok') {
        return {
          ...head,
          modules: own.map((m) => ({
            module: m.name,
            connection: connection.name,
            configured: false,
            status: head.status,
            message: `connection "${connection.name}" is unavailable: ${head.message ?? 'not configured'}`,
            code: 'connection_unavailable',
          })),
        }
      }
      return { ...head, modules: await Promise.all(own.map((m) => collectModule(m, resolveConfig))) }
    }),
  )

  const reports = grouped.flatMap((g) => g.modules)
  const summary = {
    ok: reports.filter((r) => r.status === 'ok').length,
    error: reports.filter((r) => r.status === 'error').length,
    notConfigured: reports.filter((r) => r.status === 'not_configured').length,
  }
  const status: RootStatusState = summary.error > 0 ? 'degraded' : summary.ok > 0 ? 'ok' : 'not_configured'

  return { status, summary, connections: grouped }
}
```

- [ ] **Step 4: Update the callers**

In `apps/home/src/commands/status.ts`, call `collectStatuses(connections, modules, resolveModuleConfig, resolveConnectionConfig)`, importing `connections` and `modules` from `../registry`. Add `resolveConnectionConfig` to `citty.ts` next to `resolveModuleConfig`:

```ts
export function resolveConnectionConfig(connection: ConnectionManifest): ModuleConfig | null {
  return readStoredConfig(connection.name, connection.configSchema)
}
```

In `makeStatusCommand`, probe the connection first and return its remedy when it is unhealthy:

```ts
      const connection = connectionFor(manifest, registered)
      if (connection) {
        const head = await probeConnection(connection, resolveConnectionConfig)
        if (head.status !== 'ok') {
          await emit(
            {
              ok: false,
              kind: 'config',
              message: `connection "${connection.name}" is unavailable: ${head.message ?? 'not configured'} — run \`home ${manifest.name} configure\``,
              code: 'connection_unavailable',
            },
            { json: env.json },
          )
          return
        }
      }
```

Export `probeConnection` from `core/status.ts` as a thin wrapper over `collectConnection` so `citty.ts` reuses the same code path:

```ts
export async function probeConnection(
  connection: ConnectionManifest,
  resolveConnectionConfig: ConnectionConfigResolver,
): Promise<Omit<ConnectionStatusReport, 'modules'>> {
  return collectConnection(connection, resolveConnectionConfig)
}
```

- [ ] **Step 5: Update the status view**

`apps/home/src/core/status-view.ts` renders the flat `modules` array at lines 57-61. Replace that block with a connection-grouped walk. A connection whose name matches its only module renders as a single row rather than a header plus one child — a one-to-one pair is one thing to the reader.

```ts
function isPair(group: ConnectionStatusReport): boolean {
  return group.modules.length === 1 && group.modules[0]!.module === group.connection
}

function rowsFor(report: RootStatusReport, c: ReturnType<typeof palette>): string[] {
  const labels = report.connections.flatMap((g) =>
    isPair(g) ? [g.connection] : [g.connection, ...g.modules.map((m) => `  ${m.module}`)],
  )
  const width = labels.reduce((max, l) => Math.max(max, l.length), 0)
  const row = (label: string, state: ModuleStatusState): string => {
    const paint = paintFor(state, c)
    return `  ${paint(SYMBOL[state])} ${c.bold(label.padEnd(width))}   ${paint(LABEL[state])}`
  }

  return report.connections.flatMap((g) =>
    isPair(g)
      ? [row(g.connection, g.modules[0]!.status)]
      : [row(g.connection, g.status), ...g.modules.map((m) => row(`  ${m.module}`, m.status))],
  )
}
```

Then in `renderStatus`, replace the `width`/`rows` lines with `const rows = rowsFor(report, c)` and import `ConnectionStatusReport` alongside the existing type imports. Update the `status-view.test.ts` fixtures to the new `RootStatusReport` shape — they currently build a flat `modules` array.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/home/src/core/status.ts apps/home/src/core/status-view.ts apps/home/src/core/citty.ts apps/home/src/commands/status.ts apps/home/src/__tests__/status.test.ts apps/home/src/__tests__/status-view.test.ts
git commit -m "feat(core): status probes connections once and groups modules beneath them"
```

---

### Task 6: `home logout <connection>`

**Files:**
- Create: `apps/home/src/commands/logout.ts`
- Modify: `apps/home/src/index.ts`
- Test: `apps/home/src/__tests__/logout.test.ts`

**Interfaces:**
- Consumes: `connections`, `modules` from the registry; `listSecretKeys`, `deleteSecret` from `core/secrets`.
- Produces: `dependentsOf(connection: string, modules: ModuleManifest[]): string[]` and `clearGrants(names: string[]): { name: string; keys: string[] }[]`, both exported from `src/commands/logout.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/logout.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearGrants, dependentsOf } from '../commands/logout'
import { getSecret, setSecret } from '../core/secrets'
import type { ModuleManifest } from '../core/types'

const original = process.env.XDG_CONFIG_HOME
afterEach(() => {
  process.env.XDG_CONFIG_HOME = original
})

function mod(name: string, connection: string): ModuleManifest {
  return {
    name,
    connection,
    description: 'test',
    whenToUse: 'test only',
    configSchema: [],
    commands: [],
    async status() {
      return { ok: true }
    },
  }
}

describe('dependentsOf', () => {
  test('lists every module naming the connection', () => {
    const modules = [mod('gmail', 'google'), mod('gdrive', 'google'), mod('unifi', 'unifi')]
    expect(dependentsOf('google', modules)).toEqual(['gmail', 'gdrive'])
  })

  test('returns an empty list for a connection nothing uses', () => {
    expect(dependentsOf('cloudflare', [mod('gmail', 'google')])).toEqual([])
  })
})

describe('clearGrants', () => {
  test('deletes every stored secret for each named unit and reports what went', () => {
    process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'home-logout-'))
    setSecret('gmail', 'refreshToken', 'a')
    setSecret('gdrive', 'refreshToken', 'b')
    setSecret('unifi', 'apiKey', 'keep-me')

    const cleared = clearGrants(['gmail', 'gdrive'])

    expect(cleared).toEqual([
      { name: 'gmail', keys: ['refreshToken'] },
      { name: 'gdrive', keys: ['refreshToken'] },
    ])
    expect(getSecret('gmail', 'refreshToken')).toBeNull()
    expect(getSecret('unifi', 'apiKey')).toBe('keep-me')
  })

  test('reports an empty key list for a unit holding no secrets', () => {
    process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'home-logout-'))
    expect(clearGrants(['gmail'])).toEqual([{ name: 'gmail', keys: [] }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/logout.test.ts`
Expected: FAIL — `Cannot find module '../commands/logout'`

- [ ] **Step 3: Write the implementation**

Create `apps/home/src/commands/logout.ts`:

```ts
import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { emit } from '../core/output'
import { deleteSecret, listSecretKeys } from '../core/secrets'
import { connections, modules } from '../registry'
import type { ModuleManifest } from '../core/types'

export function dependentsOf(connection: string, registered: ModuleManifest[]): string[] {
  return registered.filter((m) => m.connection === connection).map((m) => m.name)
}

export function clearGrants(names: string[]): { name: string; keys: string[] }[] {
  return names.map((name) => {
    const keys = listSecretKeys(name)
    for (const key of keys) deleteSecret(name, key)
    return { name, keys }
  })
}

const args: ArgsDef = {
  connection: { type: 'positional', description: 'Connection to forget', required: true },
  yes: { type: 'boolean', description: 'Skip the confirmation prompt' },
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

export const logoutCmd: CommandDef = defineCommand({
  meta: {
    name: 'logout',
    description: "Forget a connection's stored credentials and every grant held by modules that use it",
  },
  args,
  async run({ args }) {
    const raw = args as Record<string, unknown>
    const json = Boolean(raw.json)
    const name = String(raw.connection)

    if (!connections.some((c) => c.name === name)) {
      await emit(
        {
          ok: false,
          kind: 'user',
          message: `unknown connection "${name}" — known: ${connections.map((c) => c.name).join(', ')}`,
          code: 'unknown_connection',
        },
        { json },
      )
      return
    }

    const targets = [name, ...dependentsOf(name, modules).filter((m) => m !== name)]
    if (!raw.yes) {
      await emit(
        {
          ok: false,
          kind: 'user',
          message: `would forget stored credentials for: ${targets.join(', ')} — re-run with --yes`,
          code: 'confirmation_required',
        },
        { json },
      )
      return
    }

    // Nothing is revoked server-side: this only drops what is stored here, so
    // re-running each module's `configure` restores access.
    await emit({ ok: true, data: { status: 'logged_out', cleared: clearGrants(targets) } }, { json })
  },
})
```

- [ ] **Step 4: Register the command**

In `apps/home/src/index.ts`, import `logoutCmd` from `./commands/logout` and add `logout: logoutCmd` to the root `subCommands` map, alongside the existing `status` and `secrets` entries.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test src/__tests__/logout.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Verify the dry-run guard by hand**

Run: `cd apps/home && bun run dev -- logout tts --json`
Expected: exit non-zero with `confirmation_required` and no secrets touched.

- [ ] **Step 7: Commit**

```bash
git add apps/home/src/commands/logout.ts apps/home/src/index.ts apps/home/src/__tests__/logout.test.ts
git commit -m "feat(cli): add home logout <connection>"
```

---

### Task 7: Convert every remaining module to name a connection

**Files:**
- Create: one `apps/home/src/connections/<name>/index.ts` per row of the table below, except `tts` which Task 2 created
- Modify: every `apps/home/src/modules/*/index.ts`
- Modify: `apps/home/src/registry.ts`
- Modify: `apps/home/src/core/types.ts` (make `connection` required)
- Modify: `apps/home/src/__tests__/registry-invariants.test.ts`

There is no `cloudflare` connection in this plan — Cloudflare gets its own spec and plan.

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: `ModuleManifest.connection: string` (required), and a `connections` array of sixteen entries.

Sixteen connections, fifteen of them one-to-one with a module of the same name, plus `google` backing three modules:

| Connection | Modules | Connection owns |
| --- | --- | --- |
| `google` | `gmail`, `gdrive`, `gcal`, `google` | `clientId`, `clientSecret` |
| `unifi` | `unifi` | `url`, `insecureTLS`, `apiKey` |
| `protect` | `protect` | `url`, `insecureTLS`, `username`, `password` |
| `assistant` | `assistant` | its full existing `configSchema` |
| `beszel` | `beszel` | its full existing `configSchema` |
| `discord` | `discord` | its full existing `configSchema` |
| `github` | `github` | its full existing `configSchema` |
| `graphite` | `graphite` | its full existing `configSchema` |
| `linear` | `linear` | its full existing `configSchema` |
| `sonos` | `sonos` | its full existing `configSchema` |
| `spotify` | `spotify` | its full existing `configSchema` |
| `uptime-kuma` | `uptime-kuma` | its full existing `configSchema` |
| `vercel` | `vercel` | its full existing `configSchema` |
| `tts` | `tts` | *(done in Task 2)* |

For `unifi` the module keeps `source` and `site`; for every other one-to-one case the whole schema moves up and the module's `configSchema` becomes `[]`. Nothing moves on disk — the file and secret prefix are unchanged because the names match.

- [ ] **Step 1: Widen the invariant test back to the whole registry**

In `apps/home/src/__tests__/registry-invariants.test.ts`, restore the first test to its Task 1 form:

```ts
  test('the real registry has no violations', () => {
    expect(validateRegistry(connections, modules)).toEqual([])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/registry-invariants.test.ts`
Expected: FAIL with 16 `unknown_connection` violations.

- [ ] **Step 3: Create one connection per row**

For each one-to-one row, create `apps/home/src/connections/<name>/index.ts` following this shape, moving the listed `configSchema` entries verbatim out of the module and reusing its existing `status` body:

```ts
import type { ConnectionManifest } from '../../core/types'
import { readKumaConfig, ping } from '../../modules/uptime-kuma/client'

export const connection: ConnectionManifest = {
  name: 'uptime-kuma',
  description: 'Uptime Kuma server',
  configSchema: [
    /* moved verbatim from modules/uptime-kuma/index.ts */
  ],
  async status(cfg) {
    try {
      await ping(readKumaConfig(cfg))
      return { ok: true }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default connection
```

A one-to-one module keeps its own `status` too. The connection's probe answers "can I reach it at all"; the module's answers "is my surface working". Where a module's existing `status` already does both, leave it on the module and give the connection a `status` that returns `{ ok: true }` — do not duplicate the probe.

For `google`, the connection is the existing `modules/google/index.ts` manifest minus its `logout` command: same `configSchema`, same `status` body. Leave the `google` *module* in place with `connection: 'google'`, an empty `configSchema`, and its `logout` command — [`007-GOOGLE-CONNECTION-CLEANUP`](007-GOOGLE-CONNECTION-CLEANUP.md) removes it.

- [ ] **Step 4: Add `connection` to every module manifest**

Add `connection: '<name>',` directly under `name:` in each `apps/home/src/modules/*/index.ts`. The Google trio takes `connection: 'google'`; everything else takes its own name.

- [ ] **Step 5: Register every connection**

Extend the `connections` array in `apps/home/src/registry.ts` with all sixteen imports, ordered to match the `modules` array so `home status` output stays stable.

- [ ] **Step 6: Make `connection` required**

In `apps/home/src/core/types.ts`, change `connection?: string` to `connection: string` and delete the "optional only until" note. In `core/status.ts`, simplify `manifest.connection ?? manifest.name` to `manifest.connection` in both places.

- [ ] **Step 7: Run the full suite**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS. Module tests that build a `ModuleManifest` fixture now need a `connection` field — add it; do not loosen the type.

- [ ] **Step 8: Verify against real config**

Run: `cd apps/home && bun run dev -- status --json`
Expected: every module reports the same state it did before this plan, now nested under its connection. A module that flips to `not_configured` means a `configSchema` entry was moved to a connection with a different name — find it and fix the name.

- [ ] **Step 9: Commit**

```bash
git add apps/home/src
git commit -m "feat(modules): every module names a connection"
```

---

### Task 8: `home configure` runs the chain once per connection

**Files:**
- Modify: `apps/home/src/commands/configure-all.ts`
- Test: `apps/home/src/__tests__/configure-all-order.test.ts`

**Interfaces:**
- Consumes: `connectionNeedsSetup`, `configureRunnerFor` (Task 4); `connections`, `modules` (Task 7).
- Produces: `configurePlan(connections: ConnectionManifest[], modules: ModuleManifest[], needsSetup: (c: ConnectionManifest) => boolean): { kind: 'connection' | 'module'; name: string }[]`

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/configure-all-order.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { configurePlan } from '../commands/configure-all'
import type { ConnectionManifest, ModuleManifest } from '../core/types'

function conn(name: string): ConnectionManifest {
  return { name, description: name, configSchema: [], async status() { return { ok: true } } }
}

function mod(name: string, connection: string): ModuleManifest {
  return {
    name,
    connection,
    description: name,
    whenToUse: 'test only',
    configSchema: [],
    commands: [],
    async status() {
      return { ok: true }
    },
  }
}

describe('configurePlan', () => {
  test('configures each needed connection once, before its modules', () => {
    const connections = [conn('google'), conn('tts')]
    const modules = [mod('gmail', 'google'), mod('gdrive', 'google'), mod('tts', 'tts')]

    expect(configurePlan(connections, modules, () => true)).toEqual([
      { kind: 'connection', name: 'google' },
      { kind: 'module', name: 'gmail' },
      { kind: 'module', name: 'gdrive' },
      { kind: 'connection', name: 'tts' },
      { kind: 'module', name: 'tts' },
    ])
  })

  test('skips connections that are already set up', () => {
    const connections = [conn('google')]
    const modules = [mod('gmail', 'google')]

    expect(configurePlan(connections, modules, () => false)).toEqual([{ kind: 'module', name: 'gmail' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/configure-all-order.test.ts`
Expected: FAIL — `configurePlan` is not exported.

- [ ] **Step 3: Write the implementation**

In `apps/home/src/commands/configure-all.ts`, add:

```ts
export function configurePlan(
  registered: ConnectionManifest[],
  registeredModules: ModuleManifest[],
  needsSetup: (c: ConnectionManifest) => boolean,
): { kind: 'connection' | 'module'; name: string }[] {
  const steps: { kind: 'connection' | 'module'; name: string }[] = []
  for (const connection of registered) {
    if (needsSetup(connection)) steps.push({ kind: 'connection', name: connection.name })
    for (const module of registeredModules.filter((m) => m.connection === connection.name)) {
      steps.push({ kind: 'module', name: module.name })
    }
  }
  return steps
}
```

Rewrite the command's `run` to walk that plan, resolving each step to its manifest and calling `configureRunnerFor` on it, keeping the existing per-step `consola.info` banner and the `{ module, ok, error }` result rows (widen that field to `{ kind, name, ok, error }`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/home/src/commands/configure-all.ts apps/home/src/__tests__/configure-all-order.test.ts
git commit -m "feat(cli): home configure walks connections before their modules"
```

---

### Task 9: Update the spec

**Files:**
- Modify: `docs/specs/005-MODULE-SYSTEM.md`

- [ ] **Step 1: Drop the landed markers**

Unwrap the five `PLANNED — 006-CONNECTION-LAYER` blockquotes in `docs/specs/005-MODULE-SYSTEM.md` — in *Credentials belong to the manifest that needs them*, *The registry is a static array*, *Every module gets three commands for free*, *Readiness is one probe per module*, and *Root-level commands*. Unwrapping means deleting the marker line and the `>` prefixes, leaving the prose as plain spec text, and deleting the now-false present-tense passage each one sits beside. Leave the `008-MODULE-PATHS-AND-ALIASES` and `REMOVING — 007-GOOGLE-CONNECTION-CLEANUP` markers alone.

- [ ] **Step 2: Update the frontmatter**

Change `plans:` to `[007-GOOGLE-CONNECTION-CLEANUP, 008-MODULE-PATHS-AND-ALIASES]`.

- [ ] **Step 3: Append the Landed section to this plan**

Add to the bottom of `docs/plans/006-CONNECTION-LAYER.md`:

```markdown
## Landed

**Date:** <YYYY-MM-DD>
**Commits:** <first>..<last>

**Verified:** `bun test` and `bun run typecheck` clean; `home status --json` reports
every module in the same state as before the change, grouped by connection;
`home logout tts` refuses without `--yes`.

**Corrections:** <anything the work proved wrong about this plan, or "none">
```

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs(home): mark connection layer landed"
```
