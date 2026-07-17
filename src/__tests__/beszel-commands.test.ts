import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import manifest from '../modules/beszel'
import { systemsGetCmd, systemsListCmd } from '../modules/beszel/commands/systems'
import { containersGetCmd, containersListCmd } from '../modules/beszel/commands/containers'
import { alertsListCmd } from '../modules/beszel/commands/alerts'
import { overviewCmd } from '../modules/beszel/commands/overview'
import type { RunContext, RunResult } from '../core/types'
import {
  ALERT_CPU_TRIGGERED,
  ALERT_STATUS_QUIET,
  CONTAINER_BESZEL,
  CONTAINER_CADDY,
  SYSTEM_DOWN,
  SYSTEM_PENDING,
  SYSTEM_STATS_1M,
  SYSTEM_UP,
  pbPage,
} from './beszel-fixtures'
import type { RawRecord } from '../modules/beszel/client'

const CONFIG = { url: 'http://hub.test', email: 'me@example.com', password: 'hunter22' }

function ctx(args: RunContext['args'] = {}): RunContext {
  return {
    args,
    json: true,
    quiet: true,
    verbose: false,
    log: null as unknown as RunContext['log'],
    config: CONFIG,
  }
}

function errCode(r: RunResult): string | undefined {
  return r.ok ? undefined : r.code
}

const realFetch = globalThis.fetch
let requests: URL[] = []

interface HubData {
  systems?: RawRecord[]
  containers?: RawRecord[]
  alerts?: RawRecord[]
  systemStats?: RawRecord[]
}

/** Serve a fake 0.18.x hub: password auth plus per-collection record lists. */
function stubHub(data: HubData, overrides: Partial<Record<string, (url: URL) => Response>> = {}): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input))
    requests.push(url)
    if (url.pathname === '/api/collections/users/auth-with-password') {
      return json({ token: 'tok1', record: { id: 'useraaaaaaaaaaa1' } })
    }
    const collection = url.pathname.match(/^\/api\/collections\/([^/]+)\/records$/)?.[1]
    if (collection && overrides[collection]) return overrides[collection]!(url)
    switch (collection) {
      case 'systems':
        return json(pbPage(data.systems ?? []))
      case 'containers':
        return json(pbPage(data.containers ?? []))
      case 'alerts':
        return json(pbPage(data.alerts ?? []))
      case 'system_stats':
        return json(pbPage(data.systemStats ?? []))
      default:
        return json({ status: 404, message: 'Missing collection context.' }, 404)
    }
  }) as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function paramsOf(collection: string): URLSearchParams | undefined {
  return requests.find((u) => u.pathname === `/api/collections/${collection}/records`)?.searchParams
}

beforeEach(() => {
  requests = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('systems list', () => {
  test('returns normalized systems, never raw PocketBase records', async () => {
    stubHub({ systems: [SYSTEM_UP, SYSTEM_DOWN] })
    const res = await systemsListCmd.run(ctx())
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown>[] }).data
    expect(data.map((s) => s.name)).toEqual(['boris', 'atlas'])
    expect(data[0]).not.toHaveProperty('info')
    expect(data[0]).not.toHaveProperty('collectionName')
    expect(data[0]!.updatedAt).toBe('2026-07-17T09:59:30.123Z')
  })

  test('--status down is pushed to the hub as a filter', async () => {
    stubHub({ systems: [SYSTEM_DOWN] })
    const res = await systemsListCmd.run(ctx({ status: 'down' }))
    expect(res.ok).toBe(true)
    expect(paramsOf('systems')?.get('filter')).toBe('status="down"')
  })

  test('an unknown --status is rejected before any request', async () => {
    stubHub({})
    expect(errCode(await systemsListCmd.run(ctx({ status: 'sideways' })))).toBe('bad_arg')
    expect(requests).toHaveLength(0)
  })
})

describe('systems get resolution', () => {
  test('resolves by exact id', async () => {
    stubHub({ systems: [SYSTEM_UP, SYSTEM_DOWN] })
    const res = await systemsGetCmd.run(ctx({ system: 'sysbbbbbbbbbbbb2' }))
    expect(res.ok).toBe(true)
    expect((res as { data: { name: string } }).data.name).toBe('atlas')
  })

  test('resolves by exact case-insensitive name and attaches the latest 1m stats', async () => {
    stubHub({ systems: [SYSTEM_UP, SYSTEM_DOWN], systemStats: [SYSTEM_STATS_1M] })
    const res = await systemsGetCmd.run(ctx({ system: 'BORIS' }))
    expect(res.ok).toBe(true)
    const data = (res as { data: { id: string; stats: { cpuPct: number } } }).data
    expect(data.id).toBe('sysaaaaaaaaaaaa1')
    expect(data.stats.cpuPct).toBe(12.4)
    const statsParams = paramsOf('system_stats')
    expect(statsParams?.get('filter')).toBe('system="sysaaaaaaaaaaaa1" && type="1m"')
    expect(statsParams?.get('sort')).toBe('-created')
  })

  test('never picks between ambiguous names — returns candidates with a stable code', async () => {
    const twin = { ...SYSTEM_DOWN, id: 'sysdddddddddddd4', name: 'Boris' }
    stubHub({ systems: [SYSTEM_UP, twin] })
    const res = await systemsGetCmd.run(ctx({ system: 'boris' }))
    expect(errCode(res)).toBe('ambiguous')
    const message = (res as { message: string }).message
    expect(message).toContain('sysaaaaaaaaaaaa1')
    expect(message).toContain('sysdddddddddddd4')
  })

  test('no substring matching: a partial name is not_found', async () => {
    stubHub({ systems: [SYSTEM_UP] })
    expect(errCode(await systemsGetCmd.run(ctx({ system: 'bor' })))).toBe('not_found')
  })
})

describe('containers', () => {
  test('list resolves the system then filters containers to it', async () => {
    stubHub({ systems: [SYSTEM_UP, SYSTEM_DOWN], containers: [CONTAINER_CADDY, CONTAINER_BESZEL] })
    const res = await containersListCmd.run(ctx({ system: 'boris' }))
    expect(res.ok).toBe(true)
    const data = (res as { data: { system: { id: string }; containers: { name: string; health: string | null }[] } }).data
    expect(data.system.id).toBe('sysaaaaaaaaaaaa1')
    expect(data.containers.map((c) => c.name)).toEqual(['caddy', 'beszel'])
    expect(data.containers[0]!.health).toBe('healthy')
    expect(paramsOf('containers')?.get('filter')).toBe('system="sysaaaaaaaaaaaa1"')
  })

  test('list is bounded: --limit caps perPage', async () => {
    stubHub({ systems: [SYSTEM_UP], containers: [CONTAINER_CADDY] })
    await containersListCmd.run(ctx({ system: 'boris', limit: 1 }))
    expect(paramsOf('containers')?.get('perPage')).toBe('1')
  })

  test('get resolves the container by exact id and by exact ci name', async () => {
    stubHub({ systems: [SYSTEM_UP], containers: [CONTAINER_CADDY, CONTAINER_BESZEL] })
    const byId = await containersGetCmd.run(ctx({ system: 'boris', container: 'd4e5f6' }))
    expect((byId as { data: { name: string } }).data.name).toBe('beszel')
    const byName = await containersGetCmd.run(ctx({ system: 'boris', container: 'CADDY' }))
    expect((byName as { data: { id: string } }).data.id).toBe('a1b2c3')
  })

  test('get reports ambiguous container names instead of picking one', async () => {
    const twin = { ...CONTAINER_CADDY, id: 'ffffff', name: 'Caddy' }
    stubHub({ systems: [SYSTEM_UP], containers: [CONTAINER_CADDY, twin] })
    expect(errCode(await containersGetCmd.run(ctx({ system: 'boris', container: 'caddy' })))).toBe('ambiguous')
  })
})

describe('alerts list', () => {
  test('returns normalized alerts with expanded system names', async () => {
    stubHub({ alerts: [ALERT_CPU_TRIGGERED, ALERT_STATUS_QUIET] })
    const res = await alertsListCmd.run(ctx())
    expect(res.ok).toBe(true)
    const data = (res as { data: { type: string; systemName: string | null }[] }).data
    expect(data.map((a) => a.type)).toEqual(['CPU', 'Status'])
    expect(data[0]!.systemName).toBe('boris')
    expect(paramsOf('alerts')?.get('expand')).toBe('system')
  })

  test('--active and --system combine into one hub-side filter', async () => {
    stubHub({ systems: [SYSTEM_UP, SYSTEM_DOWN], alerts: [ALERT_CPU_TRIGGERED] })
    const res = await alertsListCmd.run(ctx({ system: 'boris', active: true }))
    expect(res.ok).toBe(true)
    expect(paramsOf('alerts')?.get('filter')).toBe('system="sysaaaaaaaaaaaa1" && triggered=true')
  })
})

describe('overview + status', () => {
  test('overview counts statuses and active alerts in two data queries', async () => {
    stubHub(
      { systems: [SYSTEM_UP, SYSTEM_DOWN, SYSTEM_PENDING] },
      { alerts: () => json(pbPage([ALERT_CPU_TRIGGERED], { totalItems: 3 })) },
    )
    const res = await overviewCmd.run(ctx())
    expect(res.ok).toBe(true)
    const data = (res as { data: { systems: Record<string, number>; activeAlerts: number; hosts: unknown[] } }).data
    expect(data.systems).toEqual({ total: 3, up: 1, down: 1, paused: 0, pending: 1 })
    expect(data.activeAlerts).toBe(3)
    expect(data.hosts).toHaveLength(3)
    expect(requests.filter((u) => u.pathname.includes('/records'))).toHaveLength(2)
    expect(paramsOf('alerts')?.get('filter')).toBe('triggered=true')
  })

  test('status(): a down system is degraded data, not an API failure', async () => {
    stubHub(
      { systems: [SYSTEM_UP, SYSTEM_DOWN] },
      { alerts: () => json(pbPage([ALERT_CPU_TRIGGERED], { totalItems: 1 })) },
    )
    const res = await manifest.status(CONFIG)
    expect(res.ok).toBe(true)
    const data = (res as { data: { systems: Record<string, number>; activeAlerts: number } }).data
    expect(data.systems.up).toBe(1)
    expect(data.systems.down).toBe(1)
    expect(data.activeAlerts).toBe(1)
    expect(requests.filter((u) => u.pathname.includes('/records'))).toHaveLength(2)
  })

  test('status(): auth failure is reported as config, with the auth code', async () => {
    globalThis.fetch = (async () => json({ status: 400, message: 'Failed to authenticate.' }, 400)) as unknown as typeof fetch
    const res = await manifest.status(CONFIG)
    expect(res).toMatchObject({ ok: false, kind: 'config', code: 'beszel_auth_failed' })
  })

  test('status(): password-auth-disabled hub surfaces beszel_auth_unavailable', async () => {
    globalThis.fetch = (async () =>
      json(
        { status: 403, message: 'The collection is not configured to allow password authentication.' },
        403,
      )) as unknown as typeof fetch
    const res = await manifest.status(CONFIG)
    expect(res).toMatchObject({ ok: false, kind: 'config', code: 'beszel_auth_unavailable' })
  })

  test('status(): schema drift surfaces beszel_incompatible_version', async () => {
    const { status: _, ...driftedSystem } = SYSTEM_UP
    stubHub({ systems: [driftedSystem] })
    const res = await manifest.status(CONFIG)
    expect(res).toMatchObject({ ok: false, kind: 'system', code: 'beszel_incompatible_version' })
  })

  test('status(): upstream failure is a system error, distinct from auth', async () => {
    stubHub({}, { systems: () => json({ status: 404, message: 'Missing collection context.' }, 404) })
    const res = await manifest.status(CONFIG)
    expect(res).toMatchObject({ ok: false, kind: 'system', code: 'status_failed' })
  })

  test('status(): unconfigured module reports config kind', async () => {
    const res = await manifest.status({})
    expect(res).toMatchObject({ ok: false, kind: 'config', code: 'beszel_not_configured' })
  })
})
