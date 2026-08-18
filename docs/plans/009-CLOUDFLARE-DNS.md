---
spec: 011-CLOUDFLARE-DNS
---

# Cloudflare DNS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read and edit Cloudflare DNS from the CLI, with the never-proxy rule on `uptonm.io` enforced in code rather than remembered.

**Architecture:** A `cloudflare` connection holding one scoped API token, and one `cloudflare-dns` module mounted at `['cloudflare','dns']`. All behaviour is specified in [`011-CLOUDFLARE-DNS`](../specs/011-CLOUDFLARE-DNS.md); this plan does not restate it.

**Tech Stack:** TypeScript, Bun, citty, consola.

## Global Constraints

- Bun ≥ 1.3.0, TypeScript only. Tests with `bun test` from `apps/home`; types with `bun run typecheck`.
- **Requires [`006-CONNECTION-LAYER`](006-CONNECTION-LAYER.md) and [`008-MODULE-PATHS-AND-ALIASES`](008-MODULE-PATHS-AND-ALIASES.md) to have landed.** Without the first there is no `ConnectionManifest`; without the second a module cannot mount at a two-segment path.
- Network calls go through `request` / `requestJson` in `src/core/http.ts`, which already carries timeout, retry-on-5xx, and backoff. Do not call `fetch` directly.
- Tests never reach the network. Inject a fetch-shaped function, following the pattern in `src/__tests__/linear-client.test.ts` and `beszel-client.test.ts`.
- This plan adds a module, so it ends with `bun run build:install && home skill install`.

---

### Task 1: The connection and its API envelope

**Files:**
- Create: `apps/home/src/connections/cloudflare/index.ts`
- Create: `apps/home/src/connections/cloudflare/client.ts`
- Test: `apps/home/src/__tests__/cloudflare-client.test.ts`

**Interfaces:**
- Produces:
  - `const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'`
  - `interface CloudflareCredentials { apiToken: string }`
  - `readCloudflareCredentials(cfg: ModuleConfig): CloudflareCredentials`
  - `cfRequest<T>(creds, path: string, init?: RequestInit, fetchImpl?: typeof fetch): Promise<T>` — unwraps the envelope, throws on `success: false`
  - `cfRequestPaged<T>(creds, path: string, fetchImpl?: typeof fetch): Promise<T[]>` — follows `result_info` to the last page
  - `verifyToken(creds, fetchImpl?): Promise<{ status: string }>`
  - `connection: ConnectionManifest` named `cloudflare`

Cloudflare returns HTTP 200 with `success: false` for several real failures, so unwrapping the envelope is the whole point of `cfRequest` — a caller must never see a 200 that did not succeed.

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/cloudflare-client.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { cfRequest, cfRequestPaged, readCloudflareCredentials, verifyToken } from '../connections/cloudflare/client'
import { SystemError } from '../core/errors'

const creds = { apiToken: 'tok-123' }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('readCloudflareCredentials', () => {
  test('reads the token out of resolved config', () => {
    expect(readCloudflareCredentials({ apiToken: 'tok-123' })).toEqual({ apiToken: 'tok-123' })
  })

  test('throws NotConfiguredError naming cloudflare when the token is absent', () => {
    expect(() => readCloudflareCredentials({})).toThrow(/cloudflare/)
  })
})

describe('cfRequest', () => {
  test('sends a bearer token and returns the unwrapped result', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = String(url)
      seenAuth = String((init.headers as Record<string, string>).Authorization)
      return jsonResponse({ success: true, errors: [], messages: [], result: { id: 'z1' } })
    }) as unknown as typeof fetch

    const result = await cfRequest<{ id: string }>(creds, '/zones/z1', {}, fetchImpl)

    expect(result).toEqual({ id: 'z1' })
    expect(seenUrl).toBe('https://api.cloudflare.com/client/v4/zones/z1')
    expect(seenAuth).toBe('Bearer tok-123')
  })

  test('throws on HTTP 200 with success false, carrying cloudflare’s code', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null })
    ) as unknown as typeof fetch

    const err = await cfRequest(creds, '/zones', {}, fetchImpl).catch((e) => e)

    expect(err).toBeInstanceOf(SystemError)
    expect((err as SystemError).code).toBe('cloudflare_10000')
    expect((err as SystemError).message).toContain('Authentication error')
  })

  test('throws on a non-2xx even when the body is unparseable', async () => {
    const fetchImpl = (async () => new Response('gateway blew up', { status: 502 })) as unknown as typeof fetch
    await expect(cfRequest(creds, '/zones', {}, fetchImpl)).rejects.toBeInstanceOf(SystemError)
  })
})

describe('cfRequestPaged', () => {
  test('follows every page and concatenates results', async () => {
    const pages = [
      { success: true, errors: [], result: [{ id: 'a' }], result_info: { page: 1, total_pages: 2 } },
      { success: true, errors: [], result: [{ id: 'b' }], result_info: { page: 2, total_pages: 2 } },
    ]
    const seen: string[] = []
    const fetchImpl = (async (url: string) => {
      seen.push(String(url))
      return jsonResponse(pages[seen.length - 1])
    }) as unknown as typeof fetch

    expect(await cfRequestPaged<{ id: string }>(creds, '/zones/z1/dns_records', fetchImpl)).toEqual([
      { id: 'a' },
      { id: 'b' },
    ])
    expect(seen[0]).toContain('page=1')
    expect(seen[1]).toContain('page=2')
  })

  test('preserves an existing query string when adding pagination', async () => {
    let seen = ''
    const fetchImpl = (async (url: string) => {
      seen = String(url)
      return jsonResponse({ success: true, errors: [], result: [], result_info: { page: 1, total_pages: 1 } })
    }) as unknown as typeof fetch

    await cfRequestPaged(creds, '/zones/z1/dns_records?type=A', fetchImpl)

    expect(seen).toContain('type=A')
    expect(seen).toContain('page=1')
  })
})

describe('verifyToken', () => {
  test('returns the token status', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ success: true, errors: [], result: { id: 't1', status: 'active' } })
    ) as unknown as typeof fetch

    expect(await verifyToken(creds, fetchImpl)).toMatchObject({ status: 'active' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/cloudflare-client.test.ts`
Expected: FAIL — `Cannot find module '../connections/cloudflare/client'`

- [ ] **Step 3: Write the client**

Create `apps/home/src/connections/cloudflare/client.ts`:

```ts
import { request } from '../../core/http'
import { NotConfiguredError, SystemError } from '../../core/errors'
import type { ModuleConfig } from '../../core/types'

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
export const CLOUDFLARE_CONNECTION = 'cloudflare'

export interface CloudflareCredentials {
  apiToken: string
}

export function readCloudflareCredentials(cfg: ModuleConfig): CloudflareCredentials {
  const apiToken = String(cfg.apiToken ?? '')
  if (!apiToken) throw new NotConfiguredError(CLOUDFLARE_CONNECTION, 'not_configured')
  return { apiToken }
}

interface Envelope<T> {
  success: boolean
  errors?: { code: number; message: string }[]
  result: T
  result_info?: { page: number; total_pages: number }
}

/**
 * Cloudflare answers several real failures with HTTP 200 and `success: false`,
 * so the envelope — not the status line — is what decides whether a call
 * worked. The first error's numeric code becomes the thrown code so an operator
 * can look it up directly.
 */
export async function cfRequest<T>(
  creds: CloudflareCredentials,
  path: string,
  init: RequestInit = {},
  fetchImpl?: typeof fetch,
): Promise<T> {
  const res = await doFetch(creds, path, init, fetchImpl)
  const body = (await res.json().catch(() => null)) as Envelope<T> | null
  if (!body) {
    throw new SystemError(`HTTP ${res.status} from cloudflare ${path} with no parseable body`, `http_${res.status}`)
  }
  if (!body.success) {
    const first = body.errors?.[0]
    throw new SystemError(
      `cloudflare ${path} failed: ${first?.message ?? 'unknown error'}`,
      first ? `cloudflare_${first.code}` : `http_${res.status}`,
    )
  }
  return body.result
}

export async function cfRequestPaged<T>(
  creds: CloudflareCredentials,
  path: string,
  fetchImpl?: typeof fetch,
): Promise<T[]> {
  const out: T[] = []
  const joiner = path.includes('?') ? '&' : '?'
  for (let page = 1; ; page++) {
    const res = await doFetch(creds, `${path}${joiner}page=${page}&per_page=100`, {}, fetchImpl)
    const body = (await res.json()) as Envelope<T[]>
    if (!body.success) {
      const first = body.errors?.[0]
      throw new SystemError(
        `cloudflare ${path} failed: ${first?.message ?? 'unknown error'}`,
        first ? `cloudflare_${first.code}` : 'cloudflare_failed',
      )
    }
    out.push(...body.result)
    const info = body.result_info
    if (!info || page >= info.total_pages) return out
  }
}

async function doFetch(
  creds: CloudflareCredentials,
  path: string,
  init: RequestInit,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  const url = `${CLOUDFLARE_API}${path}`
  const withAuth: RequestInit = {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${creds.apiToken}`,
      'Content-Type': 'application/json',
    },
  }
  if (fetchImpl) return fetchImpl(url, withAuth)
  return request(url, withAuth)
}

export async function verifyToken(
  creds: CloudflareCredentials,
  fetchImpl?: typeof fetch,
): Promise<{ id: string; status: string }> {
  return cfRequest<{ id: string; status: string }>(creds, '/user/tokens/verify', {}, fetchImpl)
}
```

- [ ] **Step 4: Write the connection manifest**

Create `apps/home/src/connections/cloudflare/index.ts`:

```ts
import type { ConnectionManifest } from '../../core/types'
import { readCloudflareCredentials, verifyToken } from './client'

export const connection: ConnectionManifest = {
  name: 'cloudflare',
  description: 'Cloudflare API token, scoped to Zone:Read and DNS:Edit',
  configSchema: [
    {
      key: 'apiToken',
      label: 'Cloudflare API token',
      kind: 'secret',
      required: true,
      help: 'Create at dash.cloudflare.com/profile/api-tokens with Zone:Read + DNS:Edit on the zones you want reachable. Not the global API key — that cannot be scoped.',
    },
  ],
  async status(cfg) {
    try {
      // Verifying the token needs no zone, so this separates "credential is
      // dead" from "zone is empty" — which a zone listing could not.
      const token = await verifyToken(readCloudflareCredentials(cfg))
      return { ok: true, data: { status: token.status } }
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'not_configured') {
        return { ok: false, kind: 'config', code, message: (err as Error).message }
      }
      return { ok: false, kind: 'system', code: code ?? 'status_failed', message: (err as Error).message }
    }
  },
}

export default connection
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test src/__tests__/cloudflare-client.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/connections/cloudflare apps/home/src/__tests__/cloudflare-client.test.ts
git commit -m "feat(cloudflare): add the cloudflare connection and API client"
```

---

### Task 2: Resolve a zone by name

**Files:**
- Create: `apps/home/src/modules/cloudflare-dns/zones.ts`
- Test: `apps/home/src/__tests__/cloudflare-zones.test.ts`

**Interfaces:**
- Consumes: `cfRequestPaged`, `CloudflareCredentials` from Task 1.
- Produces:
  - `interface Zone { id: string; name: string; status: string }`
  - `listZones(creds, fetchImpl?): Promise<Zone[]>`
  - `resolveZoneId(creds, nameOrId: string, fetchImpl?): Promise<string>`
  - `resetZoneCache(): void` — for tests

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/cloudflare-zones.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { listZones, resetZoneCache, resolveZoneId } from '../modules/cloudflare-dns/zones'
import { UserError } from '../core/errors'

const creds = { apiToken: 'tok' }
const ZONE_ID = 'abcdef0123456789abcdef0123456789'

function zonesResponse(zones: unknown[]): Response {
  return new Response(
    JSON.stringify({ success: true, errors: [], result: zones, result_info: { page: 1, total_pages: 1 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

beforeEach(() => resetZoneCache())

describe('listZones', () => {
  test('returns every zone the token can see', async () => {
    const fetchImpl = (async () =>
      zonesResponse([{ id: ZONE_ID, name: 'uptonm.io', status: 'active' }])
    ) as unknown as typeof fetch

    expect(await listZones(creds, fetchImpl)).toEqual([{ id: ZONE_ID, name: 'uptonm.io', status: 'active' }])
  })
})

describe('resolveZoneId', () => {
  test('resolves a zone name to its id', async () => {
    const fetchImpl = (async () =>
      zonesResponse([{ id: ZONE_ID, name: 'uptonm.io', status: 'active' }])
    ) as unknown as typeof fetch

    expect(await resolveZoneId(creds, 'uptonm.io', fetchImpl)).toBe(ZONE_ID)
  })

  test('passes a 32-char hex id straight through without a lookup', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return zonesResponse([])
    }) as unknown as typeof fetch

    expect(await resolveZoneId(creds, ZONE_ID, fetchImpl)).toBe(ZONE_ID)
    expect(called).toBe(false)
  })

  test('caches the lookup for the process lifetime', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return zonesResponse([{ id: ZONE_ID, name: 'uptonm.io', status: 'active' }])
    }) as unknown as typeof fetch

    await resolveZoneId(creds, 'uptonm.io', fetchImpl)
    await resolveZoneId(creds, 'uptonm.io', fetchImpl)

    expect(calls).toBe(1)
  })

  test('throws a UserError naming the zones it can see', async () => {
    const fetchImpl = (async () =>
      zonesResponse([{ id: ZONE_ID, name: 'uptonm.io', status: 'active' }])
    ) as unknown as typeof fetch

    const err = await resolveZoneId(creds, 'nope.example', fetchImpl).catch((e) => e)

    expect(err).toBeInstanceOf(UserError)
    expect((err as Error).message).toContain('uptonm.io')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/cloudflare-zones.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/home/src/modules/cloudflare-dns/zones.ts`:

```ts
import { cfRequestPaged, type CloudflareCredentials } from '../../connections/cloudflare/client'
import { UserError } from '../../core/errors'

export interface Zone {
  id: string
  name: string
  status: string
}

const HEX_ZONE_ID = /^[0-9a-f]{32}$/

// Process-lifetime only. A zone id is stable, but persisting it would create a
// second thing to invalidate when a zone moves between accounts, and the
// lookup costs one request.
const cache = new Map<string, string>()

export function resetZoneCache(): void {
  cache.clear()
}

export async function listZones(creds: CloudflareCredentials, fetchImpl?: typeof fetch): Promise<Zone[]> {
  return cfRequestPaged<Zone>(creds, '/zones', fetchImpl)
}

export async function resolveZoneId(
  creds: CloudflareCredentials,
  nameOrId: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  if (HEX_ZONE_ID.test(nameOrId)) return nameOrId
  const cached = cache.get(nameOrId)
  if (cached) return cached

  const zones = await listZones(creds, fetchImpl)
  const match = zones.find((z) => z.name === nameOrId)
  if (!match) {
    throw new UserError(
      `no zone named "${nameOrId}" — this token can see: ${zones.map((z) => z.name).join(', ') || '(none)'}`,
      'unknown_zone',
    )
  }
  cache.set(nameOrId, match.id)
  return match.id
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/home && bun test src/__tests__/cloudflare-zones.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/home/src/modules/cloudflare-dns apps/home/src/__tests__/cloudflare-zones.test.ts
git commit -m "feat(cloudflare-dns): resolve zones by name with a process-lifetime cache"
```

---

### Task 3: Read commands

**Files:**
- Create: `apps/home/src/modules/cloudflare-dns/records.ts`
- Create: `apps/home/src/modules/cloudflare-dns/commands/zones.ts`
- Create: `apps/home/src/modules/cloudflare-dns/commands/records.ts`
- Test: `apps/home/src/__tests__/cloudflare-records.test.ts`

**Interfaces:**
- Consumes: `resolveZoneId` (Task 2), `cfRequest`/`cfRequestPaged` (Task 1).
- Produces:
  - `interface DnsRecord { id: string; type: string; name: string; content: string; ttl: number; proxied: boolean; comment?: string }`
  - `listRecords(creds, zoneId, filters: { type?: string; name?: string; content?: string }, fetchImpl?): Promise<DnsRecord[]>`
  - `getRecord(creds, zoneId, recordId, fetchImpl?): Promise<DnsRecord>`
  - `CommandSpec` exports `zonesList`, `recordsList`, `recordsGet`

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/cloudflare-records.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { listRecords } from '../modules/cloudflare-dns/records'

const creds = { apiToken: 'tok' }

function recordsResponse(records: unknown[]): Response {
  return new Response(
    JSON.stringify({ success: true, errors: [], result: records, result_info: { page: 1, total_pages: 1 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('listRecords', () => {
  test('sends declared filters as query parameters', async () => {
    let seen = ''
    const fetchImpl = (async (url: string) => {
      seen = String(url)
      return recordsResponse([])
    }) as unknown as typeof fetch

    await listRecords(creds, 'z1', { type: 'A', name: 'home.uptonm.io' }, fetchImpl)

    expect(seen).toContain('/zones/z1/dns_records')
    expect(seen).toContain('type=A')
    expect(seen).toContain('name=home.uptonm.io')
  })

  test('omits filters that were not supplied', async () => {
    let seen = ''
    const fetchImpl = (async (url: string) => {
      seen = String(url)
      return recordsResponse([])
    }) as unknown as typeof fetch

    await listRecords(creds, 'z1', {}, fetchImpl)

    expect(seen).not.toContain('type=')
    expect(seen).not.toContain('name=')
  })

  test('returns records with proxied preserved', async () => {
    const fetchImpl = (async () =>
      recordsResponse([
        { id: 'r1', type: 'A', name: 'home.uptonm.io', content: '10.0.14.60', ttl: 1, proxied: false },
      ])
    ) as unknown as typeof fetch

    const [record] = await listRecords(creds, 'z1', {}, fetchImpl)

    expect(record).toMatchObject({ id: 'r1', proxied: false, content: '10.0.14.60' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/cloudflare-records.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the record helpers**

Create `apps/home/src/modules/cloudflare-dns/records.ts`:

```ts
import { cfRequest, cfRequestPaged, type CloudflareCredentials } from '../../connections/cloudflare/client'

export interface DnsRecord {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  proxied: boolean
  comment?: string
}

export interface RecordFilters {
  type?: string
  name?: string
  content?: string
}

export async function listRecords(
  creds: CloudflareCredentials,
  zoneId: string,
  filters: RecordFilters,
  fetchImpl?: typeof fetch,
): Promise<DnsRecord[]> {
  const params = new URLSearchParams()
  // Narrowing server-side is what keeps the full-pagination read cheap.
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return cfRequestPaged<DnsRecord>(creds, `/zones/${zoneId}/dns_records${query ? `?${query}` : ''}`, fetchImpl)
}

export async function getRecord(
  creds: CloudflareCredentials,
  zoneId: string,
  recordId: string,
  fetchImpl?: typeof fetch,
): Promise<DnsRecord> {
  return cfRequest<DnsRecord>(creds, `/zones/${zoneId}/dns_records/${recordId}`, {}, fetchImpl)
}
```

- [ ] **Step 4: Write the read commands**

Create `apps/home/src/modules/cloudflare-dns/commands/zones.ts` exporting a `zonesList` `CommandSpec` with `effect: 'read'`, no args, returning `listZones` mapped to `{ id, name, status }`.

Create `apps/home/src/modules/cloudflare-dns/commands/records.ts` exporting `recordsList` and `recordsGet`, both `effect: 'read'`. `recordsList` declares `--zone` (string, required), `--type`, `--name`, `--content`; `recordsGet` declares `--zone` plus a required `id` positional. Both resolve the zone through `resolveZoneId` and read credentials with `readCloudflareCredentials(ctx.config)`.

`recordsList` returns an array of `{ type, name, content, ttl, proxied, id }` in that key order, so the TSV human rendering leads with the columns an operator scans for and `proxied` is visible without `--json`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test src/__tests__/cloudflare-records.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/modules/cloudflare-dns apps/home/src/__tests__/cloudflare-records.test.ts
git commit -m "feat(cloudflare-dns): zones list and record reads"
```

---

### Task 4: Write commands, with proxying opt-in

**Files:**
- Create: `apps/home/src/modules/cloudflare-dns/plan.ts`
- Modify: `apps/home/src/modules/cloudflare-dns/records.ts`
- Modify: `apps/home/src/modules/cloudflare-dns/commands/records.ts`
- Test: `apps/home/src/__tests__/cloudflare-write.test.ts`

**Interfaces:**
- Produces:
  - `createRecord(creds, zoneId, body: RecordInput, fetchImpl?): Promise<DnsRecord>`
  - `updateRecord(creds, zoneId, recordId, body: Partial<RecordInput>, fetchImpl?): Promise<DnsRecord>`
  - `interface RecordInput { type: string; name: string; content: string; ttl: number; proxied: boolean; comment?: string }`
  - `planWrite(input: RecordInput, opts: { yes: boolean }): { apply: boolean; warnings: string[] }`

`planWrite` is pure so the dry-run decision and every warning are testable without a network or a config file — the same split the gmail write planners use.

- [ ] **Step 1: Write the failing test**

Create `apps/home/src/__tests__/cloudflare-write.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { planWrite } from '../modules/cloudflare-dns/plan'

const base = { type: 'A', name: 'home.uptonm.io', content: '10.0.14.60', ttl: 1, proxied: false }

describe('planWrite', () => {
  test('does not apply without --yes', () => {
    expect(planWrite(base, { yes: false })).toMatchObject({ apply: false })
  })

  test('applies with --yes and warns about nothing for an unproxied record', () => {
    expect(planWrite(base, { yes: true })).toEqual({ apply: true, warnings: [] })
  })

  test('warns loudly when proxied is turned on', () => {
    const { warnings } = planWrite({ ...base, proxied: true }, { yes: true })
    expect(warnings.join(' ')).toContain('origin IP')
    expect(warnings.join(' ')).toContain('edge')
  })

  test('refuses to apply a proxied record in a DNS-only zone without a second opt-in', () => {
    expect(planWrite({ ...base, proxied: true }, { yes: true })).toMatchObject({ apply: false })
  })

  test('a proxied record applies only when the caller opts in twice', () => {
    expect(planWrite({ ...base, proxied: true }, { yes: true, confirmProxy: true })).toMatchObject({ apply: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/cloudflare-write.test.ts`
Expected: FAIL — module not found. Note the fifth test passes an option the interface above does not declare; widen `planWrite`'s second parameter to `{ yes: boolean; confirmProxy?: boolean }` when you implement it.

- [ ] **Step 3: Write the planner**

Create `apps/home/src/modules/cloudflare-dns/plan.ts`:

```ts
import type { RecordInput } from './records'

export interface WritePlan {
  apply: boolean
  warnings: string[]
}

/**
 * Turning `proxied` on is the one change here that fails remotely, silently,
 * and hours later: `uptonm.io` resolves to a private address and is deliberately
 * never orange-clouded, because proxying hands Caddy the edge's IP instead of
 * the client's and breaks every `remote_ip` matcher in the Caddyfile. So it
 * needs its own opt-in on top of `--yes`, not a shared one.
 */
export function planWrite(
  input: RecordInput,
  opts: { yes: boolean; confirmProxy?: boolean },
): WritePlan {
  const warnings: string[] = []
  if (input.proxied) {
    warnings.push(
      `${input.name} would be served through Cloudflare's edge; the origin IP stops being visible to it, ` +
        'and any remote_ip matcher behind this name will see Cloudflare addresses instead of clients.',
    )
  }
  if (!opts.yes) return { apply: false, warnings }
  if (input.proxied && !opts.confirmProxy) return { apply: false, warnings }
  return { apply: true, warnings }
}
```

- [ ] **Step 4: Write the mutating helpers and commands**

Add `createRecord` and `updateRecord` to `records.ts`, both `cfRequest` with `method: 'POST'` / `'PATCH'` and a JSON body.

Add `recordsCreate` and `recordsUpdate` to `commands/records.ts`, both `effect: 'write'`. Args: `--zone` (required), `--type`, `--name`, `--content`, `--ttl` (number, default 1 — Cloudflare's "automatic"), `--comment`, `--proxied` (boolean, default false), `--confirm-proxy` (boolean), `--yes` (boolean). Each builds a `RecordInput`, calls `planWrite`, and when `apply` is false returns `{ ok: true, data: { dryRun: true, would: input, warnings } }` without calling Cloudflare. `recordsUpdate` takes the record id as a positional and sends only the fields that were supplied.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src/modules/cloudflare-dns apps/home/src/__tests__/cloudflare-write.test.ts
git commit -m "feat(cloudflare-dns): record create and update with proxy opt-in"
```

---

### Task 5: Delete, and register the module

**Files:**
- Modify: `apps/home/src/modules/cloudflare-dns/records.ts`, `commands/records.ts`
- Create: `apps/home/src/modules/cloudflare-dns/index.ts`
- Modify: `apps/home/src/registry.ts`
- Modify: `apps/home/src/__tests__/registry-invariants.test.ts`

**Interfaces:**
- Produces: `deleteRecord(creds, zoneId, recordId, fetchImpl?): Promise<{ id: string }>`, and the `cloudflare-dns` `ModuleManifest`.

- [ ] **Step 1: Write the failing test**

Add to `apps/home/src/__tests__/registry-invariants.test.ts`:

```ts
test('cloudflare-dns mounts under cloudflare with no short alias', () => {
  const mod = modules.find((m) => m.name === 'cloudflare-dns')!
  expect(mod.path).toEqual(['cloudflare', 'dns'])
  expect(mod.shortPath).toBeUndefined()
  expect(mod.connection).toBe('cloudflare')
})

test('every cloudflare-dns delete is classified destructive', () => {
  const mod = modules.find((m) => m.name === 'cloudflare-dns')!
  for (const cmd of mod.commands.filter((c) => c.path.at(-1) === 'delete')) {
    expect(cmd.effect).toBe('destructive')
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/home && bun test src/__tests__/registry-invariants.test.ts`
Expected: FAIL — no `cloudflare-dns` module is registered.

- [ ] **Step 3: Write delete and the manifest**

Add `deleteRecord` to `records.ts` (`method: 'DELETE'`). Add `recordsDelete` to `commands/records.ts` with `effect: 'destructive'`, a required `id` positional, `--zone`, and `--yes`; without `--yes` it fetches the record and returns `{ dryRun: true, would: 'delete', record }` so the operator sees exactly what would go.

Create `apps/home/src/modules/cloudflare-dns/index.ts`:

```ts
import type { ModuleManifest } from '../../core/types'
import { readCloudflareCredentials } from '../../connections/cloudflare/client'
import { listZones } from './zones'
import { zonesList } from './commands/zones'
import { recordsCreate, recordsDelete, recordsGet, recordsList, recordsUpdate } from './commands/records'

export const manifest: ModuleManifest = {
  name: 'cloudflare-dns',
  connection: 'cloudflare',
  path: ['cloudflare', 'dns'],
  description: 'Read and edit Cloudflare DNS records',
  whenToUse:
    'Use to inspect or change DNS in a Cloudflare zone — list zones, search records by type/name/content, and create, update, or delete a record. Reads are safe; every mutation is a dry run until you pass --yes. Turning on Cloudflare proxying additionally requires --confirm-proxy, because uptonm.io is deliberately DNS-only: proxying it hands Caddy the edge IP instead of the client and breaks remote_ip matching. `_acme-challenge` TXT records belong to Caddy’s DNS-01 renewal — they are visible here but should not be edited by hand.',
  configSchema: [],
  commands: [zonesList, recordsList, recordsGet, recordsCreate, recordsUpdate, recordsDelete],
  async status(cfg) {
    try {
      const zones = await listZones(readCloudflareCredentials(cfg))
      return { ok: true, data: { zones: zones.length, names: zones.map((z) => z.name) } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
```

The connection's probe answers whether the token is live; this one answers which zones it actually reaches, which is the module's own readiness question.

- [ ] **Step 4: Register both**

Add `cloudflareConnection` to the `connections` array and `cloudflareDnsManifest` to the `modules` array in `apps/home/src/registry.ts`.

- [ ] **Step 5: Run the full suite**

Run: `cd apps/home && bun test && bun run typecheck`
Expected: all PASS, including the registry invariants.

- [ ] **Step 6: Commit**

```bash
git add apps/home/src
git commit -m "feat(cloudflare-dns): record delete, and register the module"
```

---

### Task 6: Install and verify against the real zone

**Files:**
- Modify: `docs/specs/011-CLOUDFLARE-DNS.md`

- [ ] **Step 1: Build and install**

Run: `cd apps/home && bun run build:install && home skill install`
Expected: `~/.claude/skills/home-cloudflare-dns/SKILL.md` is created, teaching `home cloudflare dns …`.

- [ ] **Step 2: Configure through the chain**

Run: `home cloudflare-dns configure`
Expected: prompts for the Cloudflare API token via the connection, then completes with no module-level questions.

- [ ] **Step 3: Verify reads against the live zone**

```bash
home cloudflare dns zones list --json
home cloudflare dns records list --zone uptonm.io --json
home cloudflare dns records list --zone uptonm.io --type TXT --json
```
Expected: the zone list includes `uptonm.io`; every record reports `proxied: false`; the TXT filter shows any `_acme-challenge` records Caddy currently holds.

**If any record in `uptonm.io` reports `proxied: true`, stop and report it.** That is a live misconfiguration this module was built to catch, not a bug in the module.

- [ ] **Step 4: Verify the write guards without writing**

```bash
home cloudflare dns records create --zone uptonm.io --type A --name test.uptonm.io --content 10.0.14.99 --json
home cloudflare dns records create --zone uptonm.io --type A --name test.uptonm.io --content 10.0.14.99 --proxied --yes --json
```
Expected: the first returns `dryRun: true` and no record is created; the second also returns `dryRun: true`, with the proxy warning, because `--confirm-proxy` was not passed. Confirm with `records list` that neither created anything.

- [ ] **Step 5: Unwrap the spec**

`docs/specs/011-CLOUDFLARE-DNS.md` is entirely wrapped in one `PLANNED` marker. Delete that blockquote — every sentence below it is now true — and change the frontmatter to `plans: []`.

- [ ] **Step 6: Append the Landed section**

Add to the bottom of this plan:

```markdown
## Landed

**Date:** <YYYY-MM-DD>
**Commits:** <first>..<last>

**Verified:** `bun test` and `bun run typecheck` clean; `home cloudflare dns zones list`
returns the live zone set; every record in `uptonm.io` reports `proxied: false`; both
dry-run guards refuse to write without their opt-ins.

**Corrections:** <anything the work proved wrong about this plan, or "none">
```

- [ ] **Step 7: Commit**

```bash
git add docs apps/home
git commit -m "docs(cloudflare-dns): mark the module landed"
```
