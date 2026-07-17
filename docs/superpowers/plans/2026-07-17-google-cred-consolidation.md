# Google Credential Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share one Google OAuth client ID/secret across `gmail`, `gdrive` (and future `gcal`) via a new `google` module, with `configure` absorbing the OAuth browser flow so `auth login` disappears.

**Architecture:** A new `google` module owns `clientId`/`clientSecret`. `core/google-auth.ts` gains readers that assemble credentials as *shared client + per-module refresh token*. `ModuleManifest` gains an optional `configure` override so gmail/gdrive's `configure` runs OAuth instead of prompting. Per-module refresh tokens are retained deliberately: a Google password change revokes any token containing Gmail scopes, so a single shared grant would couple Drive to Gmail's revocation.

**Tech Stack:** TypeScript, Bun (runtime + test runner), citty (CLI), Biome (lint/format).

**Spec:** `docs/superpowers/specs/2026-07-17-google-cred-consolidation-design.md`

## Global Constraints

- **TypeScript only.** Never write JavaScript. Bun is the runtime, package manager, and test runner — never npm/node/yarn.
- **Comments explain *why*, never *what*.** Rename rather than annotate. A wrong comment is worse than none.
- **YAGNI / KISS.** No speculative hooks or abstraction layers.
- Module name string for the shared namespace is exactly `google`.
- Secret key for every refresh token is exactly `refreshToken`.
- Gate commands: `bun run typecheck` and `bun test`.
- **Known-red baseline (pre-existing, unrelated):** 3 tests fail in a full `bun test` run — `cross-process lock > a live foreign lock…`, `cross-process lock > a stale lock (crashed holder)…`, and `groups leave (command) > makes the room a standalone coordinator`. All are cross-file test pollution and pass in isolation. Do NOT try to fix them. Do NOT count them as regressions.
- **Do not run `bun run build:install` until the final task.** It overwrites the binary on the user's PATH.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/types.ts` | Add optional `configure` to `ModuleManifest` |
| `src/core/configure.ts` | Add `configureRunnerFor` — the testable seam |
| `src/core/citty.ts` | `makeConfigureCommand` uses the seam |
| `src/commands/configure-all.ts` | Uses the seam |
| `src/core/google-auth.ts` | `GoogleClient`, `readSharedGoogleClient`, `requireGoogleCredentials` |
| `src/modules/google/index.ts` | New module manifest — owns shared client credentials |
| `src/registry.ts` | Register `google` **before** `gdrive`/`gmail` |
| `src/modules/gmail/client.ts` | `readGmailCredentials()` — no params |
| `src/modules/gmail/configure.ts` | Becomes the real OAuth flow |
| `src/modules/gdrive/client.ts` | `readGdriveCredentials()` — no params |
| `src/modules/gdrive/configure.ts` | Becomes the real OAuth flow |
| `docs/google-setup.md` | Console walkthrough |

---

### Task 1: The `configure` seam

**Files:**
- Modify: `src/core/types.ts` (`ModuleManifest`)
- Modify: `src/core/configure.ts` (add `configureRunnerFor`)
- Modify: `src/core/citty.ts:143-147` (`makeConfigureCommand`)
- Modify: `src/commands/configure-all.ts:21`
- Test: `src/__tests__/configure-seam.test.ts` (create)

**Interfaces:**
- Produces: `configureRunnerFor(manifest: ModuleManifest): (opts?: ConfigureOpts) => Promise<void>`
- Produces: `ModuleManifest.configure?: () => Promise<void>`

Why a named `configureRunnerFor` rather than inlining `manifest.configure ?? runConfigure` in two places: `makeConfigureCommand` returns a citty `CommandDef`, which is awkward to unit-test. A pure function that resolves a manifest to its runner is directly testable, and keeps the two call sites honest about sharing one rule.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/configure-seam.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { configureRunnerFor } from '../core/configure'
import type { ModuleManifest } from '../core/types'

const base: ModuleManifest = {
  name: 'fake',
  description: 'fake module',
  whenToUse: 'never',
  configSchema: [],
  commands: [],
  async status() {
    return { ok: true, data: {} }
  },
}

describe('configureRunnerFor', () => {
  test('returns the manifest override when one is declared', async () => {
    let called = false
    const manifest: ModuleManifest = {
      ...base,
      configure: async () => {
        called = true
      },
    }
    await configureRunnerFor(manifest)()
    expect(called).toBe(true)
  })

  test('falls back to a runner when no override is declared', () => {
    // No override: the returned runner is the generic prompt-driven path.
    // Calling it would block on stdin, so only its identity is asserted.
    expect(typeof configureRunnerFor(base)).toBe('function')
    expect(base.configure).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test configure-seam`
Expected: FAIL — `configureRunnerFor` is not exported from `../core/configure`.

- [ ] **Step 3: Add the manifest field**

In `src/core/types.ts`, inside `interface ModuleManifest`, add:

```ts
  /**
   * Replaces the generic prompt-driven `configure` for modules whose setup is
   * not a set of typed answers — the Google modules authorize via a browser
   * instead. Absent means `runConfigure`.
   */
  configure?: () => Promise<void>
```

- [ ] **Step 4: Add the seam**

At the end of `src/core/configure.ts`:

```ts
export function configureRunnerFor(
  manifest: ModuleManifest,
): (opts?: ConfigureOpts) => Promise<void> {
  if (manifest.configure) return () => manifest.configure!()
  return (opts: ConfigureOpts = {}) => runConfigure(manifest, opts)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test configure-seam`
Expected: PASS — 2 pass, 0 fail.

- [ ] **Step 6: Wire both call sites**

In `src/core/citty.ts`, import `configureRunnerFor` alongside `runConfigure`, then in `makeConfigureCommand`'s `run` replace the `runConfigure(manifest, {...})` call with:

```ts
      await configureRunnerFor(manifest)({
        rotate: Boolean(raw.rotate),
        force: Boolean(raw.force),
      })
```

In `src/commands/configure-all.ts`, replace the `import { runConfigure } from '../core/configure'` with `import { configureRunnerFor } from '../core/configure'`, and replace `await runConfigure(manifest)` with:

```ts
        await configureRunnerFor(manifest)()
```

- [ ] **Step 7: Verify nothing regressed**

Run: `bun run typecheck`
Expected: clean, no output.

Run: `bun test`
Expected: the 3 known-red baseline failures ONLY. Any 4th failure is a regression — stop and investigate.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/configure.ts src/core/citty.ts src/commands/configure-all.ts src/__tests__/configure-seam.test.ts
git commit -m "Add ModuleManifest.configure seam

Lets a module replace the prompt-driven configure with its own flow.
No behavior change: nothing sets it yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shared client readers + the `google` module

**Files:**
- Modify: `src/core/google-auth.ts`
- Create: `src/modules/google/index.ts`
- Modify: `src/registry.ts`
- Test: `src/__tests__/google-shared-client.test.ts` (create)

**Interfaces:**
- Consumes: `ModuleManifest.configure?` (Task 1 — not used here, but `google` deliberately does NOT set it; its configure is the normal prompt flow)
- Produces: `GOOGLE_MODULE = 'google'`, `GoogleClient { clientId, clientSecret }`
- Produces: `readSharedGoogleClient(): GoogleClient | null`
- Produces: `requireGoogleCredentials(module: string): GoogleOAuthCredentials`

**Critical test-isolation note:** these readers touch the real config/secret store. The new test file MUST set `XDG_CONFIG_HOME` to a temp dir **before** importing anything that reads it — `core/paths` resolves it at module load. This mirrors `src/__tests__/secrets-keyring.test.ts:6-16`. Do NOT add these tests to `google-auth.test.ts`; it has no such setup and would read the user's real credentials.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/google-shared-client.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `paths` resolves XDG_CONFIG_HOME at module load — point it at a throwaway
// dir *before* importing anything that reads it, or these tests would read the
// real secret store. Mirrors secrets-keyring.test.ts.
const CONFIG_ROOT = mkdtempSync(join(tmpdir(), 'home-google-test-'))
process.env.XDG_CONFIG_HOME = CONFIG_ROOT
mkdirSync(join(CONFIG_ROOT, 'home'), { recursive: true })
writeFileSync(
  join(CONFIG_ROOT, 'home', 'config.json'),
  JSON.stringify({ $schemaVersion: 1, secretsBackend: 'file' }),
)

const { readSharedGoogleClient, requireGoogleCredentials } = await import('../core/google-auth')
const { saveModuleConfig, deleteModuleConfig } = await import('../core/config')
const { setSecret, deleteSecret } = await import('../core/secrets')

function seedClient(): void {
  saveModuleConfig('google', { $schemaVersion: 1, clientId: 'cid.apps.googleusercontent.com' })
  setSecret('google', 'clientSecret', 'csec')
}

afterEach(() => {
  deleteModuleConfig('google')
  deleteSecret('google', 'clientSecret')
  deleteSecret('gmail', 'refreshToken')
})

describe('readSharedGoogleClient', () => {
  test('returns null when the google module is unconfigured', () => {
    expect(readSharedGoogleClient()).toBeNull()
  })

  test('returns null when the client id is set but the secret is missing', () => {
    saveModuleConfig('google', { $schemaVersion: 1, clientId: 'cid.apps.googleusercontent.com' })
    expect(readSharedGoogleClient()).toBeNull()
  })

  test('assembles the client from google config + secret', () => {
    seedClient()
    expect(readSharedGoogleClient()).toEqual({
      clientId: 'cid.apps.googleusercontent.com',
      clientSecret: 'csec',
    })
  })
})

describe('requireGoogleCredentials', () => {
  test('throws google_unconfigured naming `home google configure`', () => {
    expect(() => requireGoogleCredentials('gmail')).toThrow(/home google configure/)
  })

  test('throws google_unauthorized naming the calling module', () => {
    seedClient()
    expect(() => requireGoogleCredentials('gmail')).toThrow(/home gmail configure/)
  })

  test('combines the shared client with the module refresh token', () => {
    seedClient()
    setSecret('gmail', 'refreshToken', 'rtok')
    expect(requireGoogleCredentials('gmail')).toEqual({
      clientId: 'cid.apps.googleusercontent.com',
      clientSecret: 'csec',
      refreshToken: 'rtok',
    })
  })

  test('reads a different refresh token per module', () => {
    seedClient()
    setSecret('gmail', 'refreshToken', 'gmail-tok')
    setSecret('gdrive', 'refreshToken', 'drive-tok')
    expect(requireGoogleCredentials('gmail').refreshToken).toBe('gmail-tok')
    expect(requireGoogleCredentials('gdrive').refreshToken).toBe('drive-tok')
    deleteSecret('gdrive', 'refreshToken')
  })
})

rmSync(CONFIG_ROOT, { recursive: true, force: true })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test google-shared-client`
Expected: FAIL — `readSharedGoogleClient` is not exported.

- [ ] **Step 3: Implement the readers**

In `src/core/google-auth.ts`, add these imports at the top:

```ts
import { loadModuleConfig } from './config'
import { getSecret } from './secrets'
```

Then add, after the `GoogleOAuthCredentials` interface:

```ts
/** Module name owning the shared OAuth client — also its secret namespace. */
export const GOOGLE_MODULE = 'google'

/** The half of a credential set that every Google module shares. */
export interface GoogleClient {
  clientId: string
  clientSecret: string
}

/**
 * The OAuth client shared by every Google module, or null when `google` has not
 * been configured. One Cloud project's "Desktop app" client serves every Google
 * API, so the client half lives in one namespace while each module keeps its own
 * refresh token.
 */
export function readSharedGoogleClient(): GoogleClient | null {
  const cfg = loadModuleConfig(GOOGLE_MODULE)
  const clientId = String(cfg?.clientId ?? '')
  const clientSecret = getSecret(GOOGLE_MODULE, 'clientSecret') ?? ''
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/**
 * Full credentials for `module`: the shared client plus that module's own
 * refresh token. Throws the typed errors a caller can branch on, each naming the
 * exact command that fixes it.
 */
export function requireGoogleCredentials(module: string): GoogleOAuthCredentials {
  const client = readSharedGoogleClient()
  // NotConfiguredError generates "module "x" is not configured — run
  // `home x configure`", which is already the exact remedy in both cases; only
  // the subject differs — the shared client, or this module's own grant.
  if (!client) throw new NotConfiguredError(GOOGLE_MODULE, 'google_unconfigured')
  const refreshToken = getSecret(module, 'refreshToken') ?? ''
  if (!refreshToken) throw new NotConfiguredError(module, 'google_unauthorized')
  return { ...client, refreshToken }
}
```

Add `NotConfiguredError` to the existing `./errors` import in this file.

Reusing `NotConfiguredError` (`src/core/errors.ts:24-29`) rather than hand-writing messages is deliberate: it already produces the exact remedy string, keeps the `google_unconfigured`/`google_unauthorized` codes via its second parameter, and is what `exitCodeFor` maps to exit 3.

Also update the now-stale message in `getGoogleAccessToken` (it names a command that this change deletes). Replace:

```ts
    throw new SystemError('google refresh token missing — run `auth login` to authorize', 'google_unauthorized')
```

with:

```ts
    throw new SystemError('google refresh token missing — run the module\'s `configure` to authorize', 'google_unauthorized')
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test google-shared-client`
Expected: PASS — 8 pass, 0 fail.

- [ ] **Step 5: Write the failing test for the `google` module**

Append to `src/__tests__/google-shared-client.test.ts`:

```ts
const { modules } = await import('../registry')

describe('google module', () => {
  test('is registered', () => {
    expect(modules.find((m) => m.name === 'google')).toBeDefined()
  })

  test('declares clientId and clientSecret, and no refreshToken', () => {
    const google = modules.find((m) => m.name === 'google')!
    expect(google.configSchema.map((f) => f.key)).toEqual(['clientId', 'clientSecret'])
    expect(google.configSchema.find((f) => f.key === 'clientSecret')?.kind).toBe('secret')
  })

  test('is registered before gdrive and gmail so configure-all can order correctly', () => {
    const names = modules.map((m) => m.name)
    expect(names.indexOf('google')).toBeLessThan(names.indexOf('gdrive'))
    expect(names.indexOf('google')).toBeLessThan(names.indexOf('gmail'))
  })

  test('status reports which modules hold a grant', async () => {
    seedClient()
    setSecret('gmail', 'refreshToken', 'rtok')
    const google = modules.find((m) => m.name === 'google')!
    const result = await google.status({ clientId: 'cid.apps.googleusercontent.com' })
    expect(result.ok).toBe(true)
    expect((result as { data: { authorized: string[] } }).data.authorized).toEqual(['gmail'])
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test google-shared-client`
Expected: FAIL — no module named `google` in the registry.

- [ ] **Step 7: Create the module**

Create `src/modules/google/index.ts`:

```ts
import type { ModuleManifest } from '../../core/types'
import { GOOGLE_MODULE, readSharedGoogleClient } from '../../core/google-auth'
import { getSecret } from '../../core/secrets'

/** Google modules that authorize against the shared client, in setup order. */
const GOOGLE_API_MODULES = ['gmail', 'gdrive'] as const

export const manifest: ModuleManifest = {
  name: GOOGLE_MODULE,
  description: 'Shared Google OAuth client credentials used by gmail, gdrive, and future Google modules',
  whenToUse:
    'Use to set up the one OAuth client every Google module shares. Run `home google configure` once with a Google Cloud "Desktop app" client ID/secret, then authorize each module with `home gmail configure` / `home gdrive configure`. See docs/google-setup.md for the Cloud Console walkthrough — in particular, the OAuth app must be published to Production or its refresh tokens expire after 7 days. This module holds no data commands; it only stores credentials.',
  configSchema: [
    {
      key: 'clientId',
      label: 'Google OAuth Client ID',
      kind: 'string',
      required: true,
      help: 'From a Google Cloud "Desktop app" OAuth client — see docs/google-setup.md',
    },
    {
      key: 'clientSecret',
      label: 'Google OAuth Client Secret',
      kind: 'secret',
      required: true,
      help: 'The "Client secret" shown next to the Desktop-app OAuth client',
    },
  ],
  commands: [],
  async status() {
    // No network call is possible here: a client id/secret authenticates the
    // Cloud project, never a user, so nothing is reachable without a grant.
    // What is worth reporting is which modules actually hold one.
    const client = readSharedGoogleClient()
    const authorized = GOOGLE_API_MODULES.filter((m) => getSecret(m, 'refreshToken'))
    return {
      ok: true,
      data: {
        status: client ? 'configured' : 'not configured',
        clientId: client?.clientId ?? null,
        authorized,
        unauthorized: GOOGLE_API_MODULES.filter((m) => !authorized.includes(m)),
      },
    }
  },
}

export default manifest
```

- [ ] **Step 8: Register it before gdrive and gmail**

In `src/registry.ts`, add the import:

```ts
import googleManifest from './modules/google'
```

and place `googleManifest` **before** `gdriveManifest` in the `modules` array. `configure-all` iterates this array in order, and gmail/gdrive's OAuth cannot run before the shared client exists:

```ts
export const modules: ModuleManifest[] = [unifiManifest, protectManifest, assistantManifest, spotifyManifest, sonosManifest, ttsManifest, googleManifest, gdriveManifest, gmailManifest, discordManifest, vercelManifest]
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `bun test google-shared-client`
Expected: PASS — 12 pass, 0 fail.

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/core/google-auth.ts src/modules/google/index.ts src/registry.ts src/__tests__/google-shared-client.test.ts
git commit -m "Add google module owning the shared OAuth client

One Cloud project's Desktop-app client serves every Google API, so the
client id/secret move to a shared \`google\` namespace. Registered ahead of
gdrive/gmail so configure-all reaches it first.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Convert gmail

**Files:**
- Modify: `src/modules/gmail/client.ts:22-31` (`GmailConfig`, `readGmailConfig`)
- Modify: `src/modules/gmail/index.ts` (schema, status, `requiresConfig`, commands)
- Modify: `src/modules/gmail/configure.ts` (becomes the OAuth flow)
- Delete: `src/modules/gmail/commands/auth.ts`
- Modify: `src/modules/gmail/commands/{messages,threads,labels,drafts,profile}.ts` (8 call sites)
- Modify: `src/__tests__/gmail-client.test.ts:97-102,184`

**Interfaces:**
- Consumes: `requireGoogleCredentials(module)`, `GOOGLE_MODULE` (Task 2); `ModuleManifest.configure?` (Task 1)
- Produces: `readGmailCredentials(): GmailConfig`

`readGmailConfig(cfg)` is renamed to `readGmailCredentials()` and loses its parameter — neither credential half comes from the module's own config file any more. This matches gdrive's existing naming.

- [ ] **Step 1: Delete the obsolete tests**

In `src/__tests__/gmail-client.test.ts`, **delete** the whole `readGmailConfig` test block at lines 97-102:

```ts
    expect(readGmailConfig({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })).toEqual({
      clientId: 'c',
      clientSecret: 's',
      refreshToken: 'r',
    })
    expect(readGmailConfig({})).toEqual({ clientId: '', clientSecret: '', refreshToken: '' })
```

Delete the enclosing `test(...)` wrapper too if that block was its only body.

These tests do not move here in modified form — they are **replaced** by the `requireGoogleCredentials` tests in `google-shared-client.test.ts` (Task 2), which is the only file with the `XDG_CONFIG_HOME` isolation this credential reader now needs. Re-testing assembly here would read the user's real secret store.

Remove `readGmailConfig` from this file's import list. Do **not** add `readGmailCredentials` to it — nothing left in this file calls it.

**Leave line 184 alone.** `const cfg: GmailConfig = { clientId: 'c', clientSecret: 's', refreshToken: 'r' }` stays valid: `GmailConfig` is still `GoogleOAuthCredentials`, and every API function (`listMessages(cfg, …)` etc.) still takes a credentials object. Only the *reader* changes, not the type or the call shape.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test gmail-client`
Expected: FAIL — `readGmailCredentials` is not exported.

- [ ] **Step 3: Replace the reader**

In `src/modules/gmail/client.ts`, delete the `import type { ModuleConfig }` line, add `requireGoogleCredentials` to the `core/google-auth` import, and replace `readGmailConfig`:

```ts
export type GmailConfig = GoogleOAuthCredentials

/** Shared OAuth client + gmail's own refresh token. Throws when either is absent. */
export function readGmailCredentials(): GmailConfig {
  return requireGoogleCredentials(GMAIL_MODULE)
}
```

- [ ] **Step 4: Update all 8 call sites**

In each of `src/modules/gmail/commands/messages.ts` (lines 47, 82), `threads.ts` (25, 61), `labels.ts` (14, 33), `drafts.ts` (24, 59), and `profile.ts` (14): change the import from `readGmailConfig` to `readGmailCredentials` and replace `readGmailConfig(ctx.config)` with `readGmailCredentials()`.

- [ ] **Step 5: Move the OAuth flow into configure**

Replace the entire contents of `src/modules/gmail/configure.ts`:

```ts
import { runInstalledAppOAuth, readSharedGoogleClient, GOOGLE_MODULE } from '../../core/google-auth'
import { setSecret } from '../../core/secrets'
import { NotConfiguredError } from '../../core/errors'
import { GMAIL_MODULE, GMAIL_REFRESH_TOKEN_KEY, GMAIL_SCOPES, getProfile } from './client'

/**
 * Gmail's setup is a browser consent, not a set of typed answers, so it
 * replaces the prompt-driven `runConfigure` via `ModuleManifest.configure`.
 */
export async function configureGmail(): Promise<void> {
  // Not requireGoogleCredentials: that also demands a refresh token, which is
  // precisely what this function exists to obtain.
  const client = readSharedGoogleClient()
  if (!client) throw new NotConfiguredError(GOOGLE_MODULE, 'google_unconfigured')

  const tokens = await runInstalledAppOAuth({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    scopes: GMAIL_SCOPES,
  })

  setSecret(GMAIL_MODULE, GMAIL_REFRESH_TOKEN_KEY, tokens.refreshToken)

  // Confirm the grant works end-to-end before declaring success.
  const profile = await getProfile({ ...client, refreshToken: tokens.refreshToken })
  process.stderr.write(`authorized ${profile.emailAddress ?? '(unknown account)'}\n`)
}
```

Delete `src/modules/gmail/commands/auth.ts`.

- [ ] **Step 6: Update the manifest**

In `src/modules/gmail/index.ts`: drop the `authLogin` import and its entry in `commands`; import `configureGmail` from `./configure` and `readGmailCredentials` from `./client`; drop the `clientId`/`clientSecret` fields from `configSchema`; set `requiresConfig: false`; wire `configure`; and update `status` and `whenToUse`:

```ts
  configSchema: [
    {
      // Declared, though only `configure` writes it: an undeclared secret is
      // invisible to `secrets export` and the vercel sync.
      key: 'refreshToken',
      label: 'OAuth refresh token',
      kind: 'secret',
      required: false,
      help: 'Written by `home gmail configure` (browser consent) — not typed by hand.',
    },
  ],
  requiresConfig: false,
  configure: configureGmail,
```

`whenToUse` — replace the trailing setup sentence with:

```
Requires one-time setup: `home google configure` (shared OAuth client, see docs/google-setup.md) then `home gmail configure` (browser consent).
```

`status` becomes (the only change is the reader on line 52 — it no longer takes `cfg`, so the `cfg` parameter itself goes):

```ts
  async status() {
    try {
      const profile = await getProfile(readGmailCredentials())
      return {
        ok: true,
        data: {
          status: 'authenticated',
          emailAddress: profile.emailAddress ?? '?',
          messagesTotal: profile.messagesTotal,
          threadsTotal: profile.threadsTotal,
        },
      }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
```

The catch now also carries the `google_unconfigured` / `google_unauthorized` messages thrown by `requireGoogleCredentials`, so `home gmail status` on a fresh box prints "run `home google configure`" rather than a generic failure.

- [ ] **Step 7: Verify**

Run: `bun test gmail`
Expected: PASS across `gmail-client`, `gmail-messages`, `gmail-threads`, `gmail-labels`, `gmail-drafts`.

Run: `bun run typecheck`
Expected: clean. If it reports an unused `ModuleConfig` import in `client.ts`, delete the import.

- [ ] **Step 8: Commit**

```bash
git add -A src/modules/gmail src/__tests__/gmail-client.test.ts
git commit -m "gmail: read the shared client, configure does OAuth

configure absorbs what auth login did, so setup is one verb per module
instead of configure-then-auth-login.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Convert gdrive

**Files:**
- Modify: `src/modules/gdrive/client.ts:25-51` (`GdriveConfig`, `readGdriveConfig`, `readGdriveCredentials`)
- Modify: `src/modules/gdrive/index.ts`
- Modify: `src/modules/gdrive/configure.ts`
- Modify: `src/modules/gdrive/commands/auth.ts` (keep `authLogout`, delete `authLogin`)
- Modify: `src/modules/gdrive/commands/{files-list,files-get,files-download,files-export}.ts` (5 call sites)
- Modify: `src/__tests__/secrets-keyring.test.ts:293` (test name only)

**Interfaces:**
- Consumes: `requireGoogleCredentials(module)`, `readSharedGoogleClient()` (Task 2)
- Produces: `readGdriveCredentials(): GoogleOAuthCredentials` — same name, no parameter

- [ ] **Step 1: Replace the readers**

In `src/modules/gdrive/client.ts`, delete the `import type { ModuleConfig }` line and the now-unused `getSecret` import, add `requireGoogleCredentials` to the `core/google-auth` import, and replace both `GdriveConfig`/`readGdriveConfig`/`readGdriveCredentials` with:

```ts
/** Shared OAuth client + gdrive's own refresh token. Throws when either is absent. */
export function readGdriveCredentials(): GoogleOAuthCredentials {
  return requireGoogleCredentials(MODULE_NAME)
}
```

`GdriveConfig` and `readGdriveConfig` are deleted — nothing outside this file used them except `commands/auth.ts:17`, which Step 3 rewrites.

- [ ] **Step 2: Update all 5 call sites**

In `src/modules/gdrive/commands/files-list.ts:50`, `files-get.ts:22`, `files-download.ts:31`, and `files-export.ts:38`: replace `readGdriveCredentials(ctx.config)` with `readGdriveCredentials()`.

In `src/modules/gdrive/index.ts:43`, replace `readGdriveCredentials(cfg)` with `readGdriveCredentials()`.

- [ ] **Step 3: Delete authLogin, keep authLogout**

In `src/modules/gdrive/commands/auth.ts`: delete the `authLogin` export entirely and the now-unused `readGdriveConfig` / `DRIVE_SCOPES` imports. Keep `authLogout` exactly as-is — revoking is still a distinct action.

- [ ] **Step 4: Move the OAuth flow into configure**

Replace the contents of `src/modules/gdrive/configure.ts`:

```ts
import { runInstalledAppOAuth, readSharedGoogleClient, GOOGLE_MODULE } from '../../core/google-auth'
import { setSecret } from '../../core/secrets'
import { NotConfiguredError } from '../../core/errors'
import { DRIVE_SCOPES, MODULE_NAME, REFRESH_TOKEN_KEY, getAbout } from './client'

/**
 * Drive's setup is a browser consent, not a set of typed answers, so it
 * replaces the prompt-driven `runConfigure` via `ModuleManifest.configure`.
 */
export async function configureGdrive(): Promise<void> {
  // Not requireGoogleCredentials: that also demands a refresh token, which is
  // precisely what this function exists to obtain.
  const client = readSharedGoogleClient()
  if (!client) throw new NotConfiguredError(GOOGLE_MODULE, 'google_unconfigured')

  const tokens = await runInstalledAppOAuth({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    scopes: DRIVE_SCOPES,
  })

  setSecret(MODULE_NAME, REFRESH_TOKEN_KEY, tokens.refreshToken)

  // Confirm the grant works end-to-end before declaring success.
  const about = await getAbout({ ...client, refreshToken: tokens.refreshToken })
  process.stderr.write(`authorized ${about.user?.emailAddress ?? '(unknown account)'}\n`)
}
```

- [ ] **Step 5: Update the manifest**

In `src/modules/gdrive/index.ts`: drop the `authLogin` import and its `commands` entry (keep `authLogout`); import `configureGdrive`; drop `clientId`/`clientSecret` from `configSchema` leaving only `refreshToken`; set `requiresConfig: false`; wire `configure: configureGdrive`. Replace the setup sentence in `whenToUse` with:

```
Requires a one-time `home google configure` (shared OAuth client, see docs/google-setup.md) then `home gdrive configure` (browser consent) — both interactive; you cannot drive them, so ask the user to run them.
```

The existing `status` already calls `readGdriveCredentials(cfg)` → now `readGdriveCredentials()`. Its `if (!creds.refreshToken)` early-return is now dead — `requireGoogleCredentials` throws first. Delete that branch and let the catch handle it.

- [ ] **Step 6: Fix the stale test name**

In `src/__tests__/secrets-keyring.test.ts:293`, the test name says `auth login`, which no longer exists. The assertion is still correct and must keep passing. Rename only:

```ts
  test('gdrive declares refreshToken even though only `configure` writes it', () => {
```

- [ ] **Step 7: Verify**

Run: `bun test gdrive`
Expected: PASS.

Run: `bun test secrets-keyring`
Expected: PASS — 25 pass, 0 fail.

Run: `bun run typecheck`
Expected: clean.

Run: `bun test`
Expected: the 3 known-red baseline failures ONLY.

- [ ] **Step 8: Commit**

```bash
git add -A src/modules/gdrive src/__tests__/secrets-keyring.test.ts
git commit -m "gdrive: read the shared client, configure does OAuth

Mirrors the gmail conversion. auth logout stays — revoking is still a
distinct action from setup.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The setup doc

**Files:**
- Create: `docs/google-setup.md`

- [ ] **Step 1: Write the doc**

Create `docs/google-setup.md`. It must contain, in this order:

1. A one-line statement that one Cloud project and one Desktop-app OAuth client serves every Google module.
2. **Why a client ID is required at all:** Google has no first-party CLI for Gmail/Drive/Calendar, and `gmail.readonly` is a *restricted* scope — an embedded shared client would need a CASA security assessment. BYO client is correct for a self-hosted CLI (`rclone` works the same way).
3. Numbered Console steps: create project → enable Gmail/Drive/Calendar APIs → consent screen (Google Auth Platform), user type **External** → **publish to Production** → create OAuth client, type **Desktop app**.
4. **A callout on publishing.** A project with an External consent screen and "Testing" publishing status is issued refresh tokens that **expire after 7 days**. Publishing to Production stops that. It stays unverified, which means a 100-user lifetime cap and a "Google hasn't verified this app" screen — both irrelevant for one user; click *Advanced → Go to (unsafe)*. Verification/CASA is only needed past 100 users.
5. The CLI steps: `home google configure` → `home gmail configure` → `home gdrive configure`.
6. **What breaks a working setup**, since these are the only real ongoing risks: a Google **password change revokes any refresh token containing Gmail scopes** (re-run `home gmail configure`; Drive is unaffected, which is exactly why the tokens are kept per-module); six months of total inactivity; explicit revocation at myaccount.google.com/permissions.
7. A note that Calendar has **no module yet** (see `docs/gcal-module-plan.md`) — enabling its API now only saves a second Console trip later.

Cite `https://developers.google.com/identity/protocols/oauth2#expiration` for the expiry rules.

- [ ] **Step 2: Verify the doc's claims match the code**

Confirm every command named in the doc exists: `home google configure`, `home gmail configure`, `home gdrive configure`, `home gdrive auth logout`. Confirm `auth login` appears **nowhere** in the doc.

Run: `grep -rn "auth login" docs/google-setup.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add docs/google-setup.md
git commit -m "Document Google client credential setup

Covers the Console walkthrough, and why publishing to Production is
mandatory: a Testing-status app issues refresh tokens that die in 7 days.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rebuild skills, then hand off

**Files:** none (build artifacts only)

`CLAUDE.md` makes this mandatory, not optional: gmail and gdrive both lose `auth login`, and a new `home-google` skill appears. Stale skills would advertise a command that no longer exists.

- [ ] **Step 1: Full gate**

Run: `bun run typecheck` → clean.
Run: `bun test` → the 3 known-red baseline failures ONLY.

- [ ] **Step 2: Rebuild and reinstall**

```bash
bun run build:install
home skill install
```

Note this overwrites `~/.local/bin/home` and regenerates `~/.claude/skills/home-*/`.

- [ ] **Step 3: Confirm the new surface exists**

```bash
home google --help
home gmail --help
```

Expected: `home google` lists `configure`/`status`/`skill`. `home gmail` shows `configure` and **no** `auth login`.

```bash
home google status --json
```

Expected: exit code 3 and `{"ok":false,"code":"not_configured",...}` — there is no Cloud project yet. **This is the correct result, not a failure.**

- [ ] **Step 4: Report the verification gap honestly**

The OAuth flow **cannot be exercised** in this branch: there is no Google Cloud project, so there is no client ID to consent against. A green typecheck is not evidence that `home gmail configure` works. Say so plainly in the PR body. Real verification is the user following `docs/google-setup.md`, then running `home google configure` → `home gmail configure` and seeing a live `getProfile` result.

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "Consolidate Google OAuth client credentials" --body "$(cat <<'EOF'
One Cloud project's "Desktop app" OAuth client serves every Google API, but
`gmail` and `gdrive` each demanded their own `clientId`/`clientSecret` — the
same two values, pasted twice, with `docs/gcal-module-plan.md` queued up to
make it three. This moves the client half into a shared `google` module.

## What changed

- **New `google` module** owns `clientId`/`clientSecret`. No data commands; it
  holds credentials and reports which modules have a grant.
- **`configure` absorbs the OAuth flow; `auth login` is deleted.** Setup is now
  one verb per module: `home google configure` → `home gmail configure` →
  `home gdrive configure`. `home gdrive auth logout` stays — revoking is still
  a distinct action.
- **`ModuleManifest.configure?`** lets a module replace the prompt-driven
  `runConfigure`. Nothing else sets it.
- **`docs/google-setup.md`** — the Console walkthrough.

## Refresh tokens stay per-module, deliberately

A Google password change revokes any refresh token *containing Gmail scopes*.
One shared grant across all scopes would take Drive and Calendar down with
Gmail. Separate grants confine that blast radius; the client half, which has no
such rule, is what gets shared.

## No migration

Nothing to migrate: no `gmail.json`/`gdrive.json` existed, the secret store held
only `spotify`/`protect`/`assistant`/`unifi`, and `home vercel env pull` left
both modules `not_configured`. Greenfield.

## Behavior change worth knowing

`home configure` (all modules) will now **launch browser tabs** for gmail and
gdrive mid-loop. It was already interactive. `google` is registered ahead of
both so the shared client exists before they authorize.

## Verification — read this

**The OAuth flow is NOT verified end to end.** There is no Google Cloud project
yet, so there is no client ID to consent against; `home gmail configure` could
not be exercised. Typecheck and unit tests passing is not evidence the browser
flow works.

Real verification: follow `docs/google-setup.md`, create the project, then run
`home google configure` → `home gmail configure` and confirm a live `getProfile`.

Verified here: `bun run typecheck` clean; `bun test` shows only the 3 pre-existing
baseline failures (`cross-process lock` ×2, `groups leave`) — all cross-file test
pollution on `main`, all passing in isolation, none touched by this branch.

## Deferred

Filed here rather than Linear — the `linear` CLI is not installed on this box.

- Test isolation: `secrets-keyring.test.ts` + the sonos suite leak across files.
- `gmail` has no `auth logout`; `gdrive` does. Predates this work.
- Dead `configure.ts` files in the other 8 modules (never imported).
- `gcal` module — lands with no credential work now that the seam exists.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Deferred (file in PR body, not Linear — the `linear` CLI is not installed on this box)

- Test isolation: `secrets-keyring.test.ts` and the sonos suite leak across files (3 known-red failures).
- `gmail` has no `auth logout`; `gdrive` does. Asymmetry predates this work.
- Dead `configure.ts` files in the other 8 modules follow the same never-imported pattern.
- `gcal` module — the seam means it needs no credential work.
