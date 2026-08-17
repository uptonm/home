---
spec: 005-MODULE-SYSTEM
---

# Google Connection Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the `google` pseudo-module and the duplication it was standing in for, now that a real `google` connection exists.

**Architecture:** [`006-CONNECTION-LAYER`](006-CONNECTION-LAYER.md) left the `google` module in place holding only a `logout` command, because deleting it in the same change would have mixed a structural move with a behavioral one. This plan removes it, collapses the three byte-identical Google `configure.ts` files into one helper, and drops the `refreshToken` entry that `gmail`, `gdrive`, and `gcal` declare but never prompt for.

**Tech Stack:** TypeScript, Bun, citty, consola.

## Global Constraints

- Bun ≥ 1.3.0, TypeScript only. Tests with `bun test` from `apps/home`; types with `bun run typecheck`.
- The connection/module split, the shared namespace, and the invariants are specified in [`005-MODULE-SYSTEM`](../specs/005-MODULE-SYSTEM.md).
- Requires [`006-CONNECTION-LAYER`](006-CONNECTION-LAYER.md) to have landed.
- This plan changes `home google logout` to `home logout google` and removes `home google status`, so it ends with `bun run build:install && home skill install`.

---

### Task 1: One authorization helper for every Google module

**Files:**
- Create: `apps/home/src/connections/google/authorize.ts`
- Modify: `apps/home/src/modules/gmail/configure.ts`, `apps/home/src/modules/gdrive/configure.ts`, `apps/home/src/modules/gcal/configure.ts`
- Test: `apps/home/src/__tests__/google-authorize.test.ts`

**Interfaces:**
- Consumes: `readSharedGoogleClient`, `runInstalledAppOAuth`, `GoogleOAuthCredentials` from `src/core/google-auth.ts`; `setSecret` from `src/core/secrets.ts`.
- Produces:
  ```ts
  interface AuthorizeOptions {
    module: string
    scopes: string[]
    /** Proves the grant works before success is claimed; returns the account label. */
    verify: (creds: GoogleOAuthCredentials) => Promise<string>
    runOAuth?: typeof runInstalledAppOAuth
    notify?: (message: string) => void
  }
  authorizeGoogleModule(opts: AuthorizeOptions): Promise<string>
  ```

The three existing files differ only in their scope constant and their verification call — `getProfile` returning `emailAddress` for gmail, `getAbout` returning `user.emailAddress` for gdrive, and gcal's equivalent. `runOAuth` and `notify` are injectable so the helper is testable without a browser.

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/google-authorize.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorizeGoogleModule } from '../connections/google/authorize'
import { getSecret, setSecret } from '../core/secrets'
import { saveModuleConfig } from '../core/config'
import { NotConfiguredError } from '../core/errors'
import type { TokenSet } from '../core/google-auth'

const original = process.env.XDG_CONFIG_HOME
afterEach(() => {
  process.env.XDG_CONFIG_HOME = original
})

function isolate(): void {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'home-gauth-'))
}

function withClient(): void {
  isolate()
  saveModuleConfig('google', { $schemaVersion: 1, clientId: 'cid' })
  setSecret('google', 'clientSecret', 'csecret')
}

const tokens: TokenSet = { refreshToken: 'rt-123', accessToken: 'at', expiresIn: 3600 }

describe('authorizeGoogleModule', () => {
  test('stores the refresh token under the module and returns the verified account', async () => {
    withClient()
    const notes: string[] = []

    const account = await authorizeGoogleModule({
      module: 'gmail',
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      verify: async (creds) => {
        expect(creds).toEqual({ clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rt-123' })
        return 'me@example.com'
      },
      runOAuth: async () => tokens,
      notify: (m) => notes.push(m),
    })

    expect(account).toBe('me@example.com')
    expect(getSecret('gmail', 'refreshToken')).toBe('rt-123')
    expect(notes.join('\n')).toContain('me@example.com')
  })

  test('passes the module scopes to the OAuth flow', async () => {
    withClient()
    let seen: string[] = []

    await authorizeGoogleModule({
      module: 'gcal',
      scopes: ['scope-a', 'scope-b'],
      verify: async () => 'me@example.com',
      runOAuth: async (opts) => {
        seen = opts.scopes
        return tokens
      },
      notify: () => {},
    })

    expect(seen).toEqual(['scope-a', 'scope-b'])
  })

  test('throws NotConfiguredError naming google when the shared client is unset', async () => {
    isolate()
    await expect(
      authorizeGoogleModule({
        module: 'gmail',
        scopes: ['s'],
        verify: async () => 'x',
        runOAuth: async () => tokens,
        notify: () => {},
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError)
  })

  test('does not store a token when verification fails', async () => {
    withClient()
    await expect(
      authorizeGoogleModule({
        module: 'gdrive',
        scopes: ['s'],
        verify: async () => {
          throw new Error('403 insufficient scope')
        },
        runOAuth: async () => tokens,
        notify: () => {},
      }),
    ).rejects.toThrow('403 insufficient scope')

    expect(getSecret('gdrive', 'refreshToken')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/google-authorize.test.ts`
Expected: FAIL — `Cannot find module '../connections/google/authorize'`

- [ ] **Step 3: Write the helper**

Create `apps/home/src/connections/google/authorize.ts`:

```ts
import {
  GOOGLE_MODULE,
  readSharedGoogleClient,
  runInstalledAppOAuth,
  type GoogleOAuthCredentials,
} from '../../core/google-auth'
import { NotConfiguredError } from '../../core/errors'
import { setSecret } from '../../core/secrets'

/** Secret key every Google module stores its refresh token under. */
export const REFRESH_TOKEN_KEY = 'refreshToken'

export interface AuthorizeOptions {
  module: string
  scopes: string[]
  verify: (creds: GoogleOAuthCredentials) => Promise<string>
  runOAuth?: typeof runInstalledAppOAuth
  notify?: (message: string) => void
}

/**
 * The browser consent every Google module shares. Setup is not a set of typed
 * answers, so this replaces the prompt loop via `ModuleManifest.configure`.
 *
 * The token is verified before it is stored: a grant that came back with too
 * few scopes would otherwise sit in the keyring and fail later as a 403 that
 * names the wrong subject.
 */
export async function authorizeGoogleModule(opts: AuthorizeOptions): Promise<string> {
  const notify = opts.notify ?? ((m: string) => process.stderr.write(m + '\n'))
  const runOAuth = opts.runOAuth ?? runInstalledAppOAuth

  // Not requireGoogleCredentials: that also demands a refresh token, which is
  // precisely what this function exists to obtain.
  const client = readSharedGoogleClient()
  if (!client) throw new NotConfiguredError(GOOGLE_MODULE, 'google_unconfigured')

  const tokens = await runOAuth({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    scopes: opts.scopes,
  })

  const account = await opts.verify({ ...client, refreshToken: tokens.refreshToken })
  setSecret(opts.module, REFRESH_TOKEN_KEY, tokens.refreshToken)
  notify(`authorized ${account}`)
  return account
}
```

- [ ] **Step 4: Collapse the three configure files**

Replace `apps/home/src/modules/gmail/configure.ts` with:

```ts
import { authorizeGoogleModule } from '../../connections/google/authorize'
import { GMAIL_MODULE, GMAIL_SCOPES, getProfile } from './client'

export async function configureGmail(): Promise<void> {
  await authorizeGoogleModule({
    module: GMAIL_MODULE,
    scopes: [...GMAIL_SCOPES],
    verify: async (creds) => (await getProfile(creds)).emailAddress ?? '(unknown account)',
  })
}
```

Apply the same shape to `gdrive/configure.ts` (`MODULE_NAME`, `DRIVE_SCOPES`, `getAbout`, `about.user?.emailAddress`) and to `gcal/configure.ts` with its own constants.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/connections/google apps/home/src/modules/gmail/configure.ts apps/home/src/modules/gdrive/configure.ts apps/home/src/modules/gcal/configure.ts apps/home/src/__tests__/google-authorize.test.ts
git commit -m "refactor(google): one authorization helper for gmail, gdrive, and gcal"
```

---

### Task 2: Delete the google pseudo-module

**Files:**
- Delete: `apps/home/src/modules/google/index.ts`
- Modify: `apps/home/src/registry.ts`
- Modify: `apps/home/src/connections/google/index.ts`
- Modify: `apps/home/src/__tests__/google-shared-client.test.ts`
- Test: `apps/home/src/__tests__/registry-invariants.test.ts` (already asserts the shape)

**Interfaces:**
- Consumes: `dependentsOf`, `clearGrants` from `src/commands/logout.ts` (plan 006, task 6).
- Produces: nothing new. `home logout google` replaces `home google logout`; the connection's `status` gains the `authorized` / `unauthorized` breakdown the module used to report.

The module's `logout` command and its hardcoded `GOOGLE_API_MODULES = ['gmail','gdrive','gcal']` both disappear: `home logout google` derives the same list from the registry.

- [ ] **Step 1: Write the failing test**

Add to `apps/home/src/__tests__/google-shared-client.test.ts`:

```ts
import { connections, modules } from '../registry'

describe('google connection', () => {
  test('no google module is registered', () => {
    expect(modules.find((m) => m.name === 'google')).toBeUndefined()
  })

  test('the google connection reports which modules hold a grant', async () => {
    process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'home-gconn-'))
    saveModuleConfig('google', { $schemaVersion: 1, clientId: 'cid' })
    setSecret('google', 'clientSecret', 'csecret')
    setSecret('gmail', 'refreshToken', 'rt')

    const google = connections.find((c) => c.name === 'google')!
    const result = await google.status({ clientId: 'cid', clientSecret: 'csecret' })

    expect(result).toMatchObject({
      ok: true,
      data: { status: 'configured', clientId: 'cid', authorized: ['gmail'] },
    })
    expect((result as { data: { unauthorized: string[] } }).data.unauthorized.sort()).toEqual(['gcal', 'gdrive'])
  })
})
```

Add the imports the block needs (`mkdtempSync`, `tmpdir`, `join`, `saveModuleConfig`, `setSecret`) if the file does not already have them.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/google-shared-client.test.ts`
Expected: FAIL — a `google` module is still registered, and the connection's `status` reports no `authorized` list.

- [ ] **Step 3: Move the dependant breakdown onto the connection**

In `apps/home/src/connections/google/index.ts`, replace the `status` body with a registry-derived version:

```ts
import { modules } from '../../registry'
import { REFRESH_TOKEN_KEY } from './authorize'

  async status() {
    // No network call is possible here: a client id/secret authenticates the
    // Cloud project, never a user, so nothing is reachable without a grant.
    // What is worth reporting is which modules actually hold one.
    const client = readSharedGoogleClient()
    const dependants = modules.filter((m) => m.connection === 'google').map((m) => m.name)
    const authorized = dependants.filter((m) => getSecret(m, REFRESH_TOKEN_KEY))
    return {
      ok: true,
      data: {
        status: client ? 'configured' : 'not configured',
        clientId: client?.clientId ?? null,
        authorized,
        unauthorized: dependants.filter((m) => !authorized.includes(m)),
      },
    }
  },
```

`src/registry.ts` imports this file, and this file now imports `src/registry.ts`. That cycle resolves because `status` reads `modules` at call time, not at module scope — do not hoist it to a top-level constant.

- [ ] **Step 4: Delete the module**

Delete `apps/home/src/modules/google/index.ts` and remove its import and array entry from `apps/home/src/registry.ts`. Move `resetGoogleTokenCache()` — which `logout` used to call — into `clearGrants` in `src/commands/logout.ts` so `home logout google` still drops cached access tokens:

```ts
export function clearGrants(names: string[]): { name: string; keys: string[] }[] {
  const cleared = names.map((name) => {
    const keys = listSecretKeys(name)
    for (const key of keys) deleteSecret(name, key)
    return { name, keys }
  })
  // In-memory access tokens outlive the secrets they came from.
  resetGoogleTokenCache()
  return cleared
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS, including the `registry invariants` suite.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src
git commit -m "refactor(google): delete the google pseudo-module in favor of the connection"
```

---

### Task 3: Drop the undeclarable refreshToken config field

**Files:**
- Modify: `apps/home/src/modules/gmail/index.ts`, `apps/home/src/modules/gdrive/index.ts`, `apps/home/src/modules/gcal/index.ts`
- Modify: `apps/home/src/modules/vercel/sync.ts`
- Test: `apps/home/src/__tests__/vercel-sync.test.ts`

**Interfaces:**
- Consumes: `connections` from the registry.
- Produces: `syncableFields(manifest: ModuleManifest, connection: ConnectionManifest): ConfigField[]` exported from `src/modules/vercel/sync.ts`.

Each Google module declares a `refreshToken` secret field that `configure` never prompts for. It exists only so `secrets export` and the Vercel sync can see the value. With connections in place, the sync can walk a module's own secrets directly instead of requiring a phantom schema entry — so the field goes.

- [ ] **Step 1: Write the failing test**

Add to `apps/home/src/__tests__/vercel-sync.test.ts`:

```ts
describe('syncable fields', () => {
  test('includes a stored secret that no schema declares', () => {
    process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'home-sync-'))
    setSecret('gmail', 'refreshToken', 'rt-abc')

    const entries = collectLocal()

    expect(entries).toContainEqual(
      expect.objectContaining({ module: 'gmail', field: 'refreshToken', secret: true, value: 'rt-abc' }),
    )
  })

  test('still excludes hostLocal fields', () => {
    process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'home-sync-'))
    saveModuleConfig('sonos', { $schemaVersion: 1, subnet: '10.0.14.0/24' })

    expect(collectLocal().find((e) => e.field === 'subnet')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/vercel-sync.test.ts`
Expected: the first test PASSES today (the phantom field makes it visible) and must keep passing after step 3 removes that field — run it again after step 3 to confirm the new path carries it.

- [ ] **Step 3: Walk stored secrets instead of declared ones**

In `apps/home/src/modules/vercel/sync.ts`, replace the `collectLocal` body (lines 70-102) so the declared-field walk is unioned with the keys actually held in the keyring. This also deletes the "no config file" special case in the doc comment above it — the union subsumes it.

```ts
export function collectLocal(): LocalEntry[] {
  const out: LocalEntry[] = []
  const seen = new Set<string>()

  const push = (owner: string, field: string, value: string, secret: boolean): void => {
    const key = encodeKey(owner, field)
    if (seen.has(key) || value === '') return
    seen.add(key)
    out.push({ module: owner, field, key, value, secret })
  }

  for (const manifest of syncableModules()) {
    const cfg = resolveModuleConfig(manifest) ?? {}
    for (const field of syncableFields(manifest)) {
      const raw = cfg[field.key]
      if (raw !== undefined) push(manifest.name, field.key, String(raw), field.kind === 'secret')
    }
    // A grant obtained by browser consent has no schema entry to declare it —
    // the keyring is the only record that it exists.
    for (const key of listSecretKeys(manifest.name)) {
      const value = getSecret(manifest.name, key)
      if (value) push(manifest.name, key, value, true)
    }
  }

  return out
}
```

`syncableFields(manifest)` still filters `hostLocal`, so `sonos`'s `subnet` never enters via the first loop. It has no keyring entry, so the second loop cannot reintroduce it.

Note that `resolveModuleConfig` returns the connection's values merged in (plan 006, task 3), so a connection's fields are already collected — under the module's name rather than the connection's. That is correct for a matched pair and harmless for `google`, whose `clientId`/`clientSecret` sync three times under `gmail`, `gdrive`, and `gcal`. If that redundancy proves annoying, narrowing it is a separate change.

- [ ] **Step 4: Delete the phantom field**

Remove the entire `refreshToken` entry from `configSchema` in all three Google module manifests, leaving `configSchema: []` and `requiresConfig: false`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS.

- [ ] **Step 6: Verify the round trip by hand**

Run: `cd apps/home && bun run dev -- vercel config push --dry-run --json`
Expected: `HOME__gmail__refreshToken` still appears in the planned set.

- [ ] **Step 7: Commit**

```bash
git add apps/home/src
git commit -m "refactor(google): drop the phantom refreshToken config field"
```

---

### Task 4: Reinstall and update the spec

**Files:**
- Modify: `docs/specs/005-MODULE-SYSTEM.md`
- Modify: `docs/plans/007-GOOGLE-CONNECTION-CLEANUP.md`

- [ ] **Step 1: Rebuild and reinstall skills**

Run: `cd apps/home && bun run build:install && home skill install`
Expected: `~/.claude/skills/home-google/` disappears from the generated set; `home-gmail`, `home-gdrive`, `home-gcal` regenerate. Delete the stale `home-google` directory by hand if the installer leaves it.

- [ ] **Step 2: Verify the connection end to end**

Run: `home status --json` then `home logout google`
Expected: the Google connection reports `authorized` and `unauthorized` lists; `home logout google` refuses without `--yes` and names `google, gmail, gdrive, gcal`.

- [ ] **Step 3: Update the spec frontmatter**

Change `plans:` to `[008-MODULE-PATHS-AND-ALIASES]`. The spec body needs no edit — it never described the `google` pseudo-module as existing.

- [ ] **Step 4: Append the Landed section**

Add to the bottom of this plan:

```markdown
## Landed

**Date:** <YYYY-MM-DD>
**Commits:** <first>..<last>

**Verified:** `bun test` and `bun run typecheck` clean; `home status` shows the Google
connection with its grant breakdown; `home logout google` names all three modules and
refuses without `--yes`; `home vercel config push --dry-run` still carries every
`refreshToken`.

**Corrections:** <anything the work proved wrong about this plan, or "none">
```

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs(home): mark google connection cleanup landed"
```
