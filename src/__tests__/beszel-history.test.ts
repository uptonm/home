import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { containerMetricsGetCmd, metricsGetCmd } from '../modules/beszel/commands/metrics'
import { smartGetCmd } from '../modules/beszel/commands/smart'
import { intervalForWindow, parseSince, pbFilterDate } from '../modules/beszel/history'
import type { RunContext, RunResult } from '../core/types'
import type { RawRecord } from '../modules/beszel/client'
import {
  CONTAINER_STATS_1M,
  CONTAINER_STATS_1M_OLDER,
  SMART_NVME,
  SMART_SATA,
  SYSTEM_STATS_1M,
  SYSTEM_UP,
  pbPage,
} from './beszel-fixtures'

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

function dataOf<T>(r: RunResult): T {
  expect(r.ok).toBe(true)
  return (r as { data: T }).data
}

const realFetch = globalThis.fetch
let requests: URL[] = []

interface HubData {
  systems?: RawRecord[]
  systemStats?: RawRecord[]
  containerStats?: RawRecord[]
  smartDevices?: RawRecord[]
}

/** Serve a fake 0.18.x hub; unknown collections 404 like PocketBase does. */
function stubHub(data: HubData): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input))
    requests.push(url)
    if (url.pathname === '/api/collections/users/auth-with-password') {
      return json({ token: 'tok1', record: { id: 'useraaaaaaaaaaa1' } })
    }
    const collection = url.pathname.match(/^\/api\/collections\/([^/]+)\/records$/)?.[1]
    switch (collection) {
      case 'systems':
        return json(pbPage(data.systems ?? [SYSTEM_UP]))
      case 'system_stats':
        return json(pbPage(data.systemStats ?? []))
      case 'container_stats':
        return json(pbPage(data.containerStats ?? []))
      case 'smart_devices':
        if (data.smartDevices === undefined) return json({ status: 404, message: 'Missing collection context.' }, 404)
        return json(pbPage(data.smartDevices))
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

/** A 1m system_stats sample `minutesAgo` before the newest fixture sample. */
function statsSample(minutesAgo: number): RawRecord {
  const created = new Date(Date.now() - minutesAgo * 60_000).toISOString().replace('T', ' ')
  return { ...SYSTEM_STATS_1M, id: `stats${String(minutesAgo).padStart(11, '0')}`, created }
}

beforeEach(() => {
  requests = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const NOW = Date.parse('2026-07-17T10:00:00.000Z')
const MINUTE = 60_000
const HOUR = 3_600_000

describe('parseSince', () => {
  test('defaults to the last 60 minutes', () => {
    expect(parseSince(undefined, NOW)).toEqual({ ok: true, sinceMs: NOW - 60 * MINUTE })
    expect(parseSince('  ', NOW)).toEqual({ ok: true, sinceMs: NOW - 60 * MINUTE })
  })

  test('parses simple durations: 30m, 6h, 2d, 45s', () => {
    expect(parseSince('30m', NOW)).toEqual({ ok: true, sinceMs: NOW - 30 * MINUTE })
    expect(parseSince('6h', NOW)).toEqual({ ok: true, sinceMs: NOW - 6 * HOUR })
    expect(parseSince('2d', NOW)).toEqual({ ok: true, sinceMs: NOW - 48 * HOUR })
    expect(parseSince('45s', NOW)).toEqual({ ok: true, sinceMs: NOW - 45_000 })
  })

  test('parses ISO 8601 timestamps and dates', () => {
    expect(parseSince('2026-07-17T08:00:00Z', NOW)).toEqual({
      ok: true,
      sinceMs: Date.parse('2026-07-17T08:00:00Z'),
    })
    expect(parseSince('2026-07-16', NOW)).toEqual({ ok: true, sinceMs: Date.parse('2026-07-16') })
  })

  test('rejects garbage instead of silently defaulting', () => {
    for (const bad of ['yesterday', '5w', '30x', 'm30', '-6h']) {
      const r = parseSince(bad, NOW)
      expect(r.ok).toBe(false)
      expect((r as { error: string }).error).toContain(bad)
    }
  })
})

describe('intervalForWindow', () => {
  test('maps windows onto the documented tiers, boundaries inclusive', () => {
    expect(intervalForWindow(30 * MINUTE)).toBe('1m')
    expect(intervalForWindow(2 * HOUR)).toBe('1m')
    expect(intervalForWindow(2 * HOUR + 1)).toBe('10m')
    expect(intervalForWindow(8 * HOUR)).toBe('10m')
    expect(intervalForWindow(8 * HOUR + 1)).toBe('20m')
    expect(intervalForWindow(24 * HOUR)).toBe('20m')
    expect(intervalForWindow(24 * HOUR + 1)).toBe('120m')
    expect(intervalForWindow(120 * HOUR)).toBe('120m')
    expect(intervalForWindow(120 * HOUR + 1)).toBe('480m')
    expect(intervalForWindow(30 * 24 * HOUR)).toBe('480m')
  })
})

describe('metrics get', () => {
  test('defaults to the last 60m at 1m; rows are timestamped normalized metrics', async () => {
    stubHub({ systemStats: [SYSTEM_STATS_1M] })
    const before = Date.now()
    const res = await metricsGetCmd.run(ctx({ system: 'boris' }))
    const data = dataOf<{
      system: { id: string }
      interval: string
      since: string
      truncated: boolean
      points: Record<string, unknown>[]
    }>(res)
    expect(data.system.id).toBe('sysaaaaaaaaaaaa1')
    expect(data.interval).toBe('1m')
    expect(data.truncated).toBe(false)
    expect(Math.abs(Date.parse(data.since) - (before - 60 * MINUTE))).toBeLessThan(5000)
    expect(data.points).toHaveLength(1)
    expect(data.points[0]).toMatchObject({
      timestamp: '2026-07-17T09:59:00.000Z',
      cpuPct: 12.4,
      memoryGb: 15.6,
      diskGb: 458.4,
      loadAvg: [0.5, 0.7, 0.9],
    })
    expect(data.points[0]).not.toHaveProperty('collectedAt')

    const params = paramsOf('system_stats')
    expect(params?.get('sort')).toBe('-created')
    expect(params?.get('filter')).toMatch(
      /^system="sysaaaaaaaaaaaa1" && type="1m" && created>="\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z"$/,
    )
  })

  test('interval is auto-selected from the --since window', async () => {
    stubHub({ systemStats: [] })
    const res = await metricsGetCmd.run(ctx({ system: 'boris', since: '12h' }))
    expect(dataOf<{ interval: string }>(res).interval).toBe('20m')
    expect(paramsOf('system_stats')?.get('filter')).toContain('type="20m"')
  })

  test('--interval overrides the auto-selection', async () => {
    stubHub({ systemStats: [] })
    const res = await metricsGetCmd.run(ctx({ system: 'boris', since: '12h', interval: '1m' }))
    expect(dataOf<{ interval: string }>(res).interval).toBe('1m')
    expect(paramsOf('system_stats')?.get('filter')).toContain('type="1m"')
  })

  test('an unknown --interval is rejected before any request', async () => {
    stubHub({})
    expect(errCode(await metricsGetCmd.run(ctx({ system: 'boris', interval: '5m' })))).toBe('bad_arg')
    expect(requests).toHaveLength(0)
  })

  test('a garbage --since is rejected before any request', async () => {
    stubHub({})
    expect(errCode(await metricsGetCmd.run(ctx({ system: 'boris', since: 'fortnight' })))).toBe('bad_arg')
    expect(requests).toHaveLength(0)
  })

  test('a garbage --max is rejected before any request', async () => {
    stubHub({})
    expect(errCode(await metricsGetCmd.run(ctx({ system: 'boris', max: 0 })))).toBe('bad_arg')
    expect(requests).toHaveLength(0)
  })

  test('the fetch is bounded: --max caps perPage at max+1 overflow probe', async () => {
    stubHub({ systemStats: [statsSample(1)] })
    await metricsGetCmd.run(ctx({ system: 'boris', max: 10 }))
    expect(paramsOf('system_stats')?.get('perPage')).toBe('11')
  })

  test('overflow sets truncated and keeps the most recent --max points, oldest-first', async () => {
    // hub returns newest-first per sort=-created
    stubHub({ systemStats: [statsSample(1), statsSample(2), statsSample(3)] })
    const res = await metricsGetCmd.run(ctx({ system: 'boris', max: 2 }))
    const data = dataOf<{ truncated: boolean; points: { timestamp: string }[] }>(res)
    expect(data.truncated).toBe(true)
    expect(data.points).toHaveLength(2)
    const [first, second] = data.points
    expect(Date.parse(first!.timestamp)).toBeLessThan(Date.parse(second!.timestamp))
    // most-recent-wins: the dropped point is the oldest (3 minutes ago)
    expect(Date.parse(second!.timestamp) - Date.parse(first!.timestamp)).toBe(MINUTE)
  })

  test('an exact --max-sized window is not marked truncated', async () => {
    stubHub({ systemStats: [statsSample(1), statsSample(2)] })
    const res = await metricsGetCmd.run(ctx({ system: 'boris', max: 2 }))
    const data = dataOf<{ truncated: boolean; points: unknown[] }>(res)
    expect(data.truncated).toBe(false)
    expect(data.points).toHaveLength(2)
  })
})

describe('container-metrics get', () => {
  test('filters to the named container; samples where it was not running are skipped', async () => {
    stubHub({ containerStats: [CONTAINER_STATS_1M, CONTAINER_STATS_1M_OLDER] })
    const res = await containerMetricsGetCmd.run(ctx({ system: 'boris', container: 'caddy' }))
    const data = dataOf<{ container: string; interval: string; points: Record<string, unknown>[] }>(res)
    expect(data.container).toBe('caddy')
    expect(data.interval).toBe('1m')
    expect(data.points).toEqual([
      {
        timestamp: '2026-07-17T09:59:00.000Z',
        cpuPct: 0.3,
        memoryMb: 45.2,
        netSentBytesPerSec: 1200,
        netRecvBytesPerSec: 3400,
      },
    ])
    expect(paramsOf('container_stats')?.get('filter')).toContain('system="sysaaaaaaaaaaaa1" && type="1m"')
  })

  test('resolves the container name case-insensitively', async () => {
    stubHub({ containerStats: [CONTAINER_STATS_1M] })
    const res = await containerMetricsGetCmd.run(ctx({ system: 'boris', container: 'CADDY' }))
    expect(dataOf<{ container: string }>(res).container).toBe('caddy')
  })

  test('a missing container is not_found with the candidates seen in the window', async () => {
    stubHub({ containerStats: [CONTAINER_STATS_1M, CONTAINER_STATS_1M_OLDER] })
    const res = await containerMetricsGetCmd.run(ctx({ system: 'boris', container: 'postgres' }))
    expect(errCode(res)).toBe('not_found')
    const message = (res as { message: string }).message
    expect(message).toContain('beszel')
    expect(message).toContain('caddy')
  })

  test('records with only deprecated ns/nr fall back to MB/s × 1024² like the hub does', async () => {
    stubHub({ containerStats: [CONTAINER_STATS_1M] })
    const res = await containerMetricsGetCmd.run(ctx({ system: 'boris', container: 'beszel' }))
    const data = dataOf<{ points: { netSentBytesPerSec: number; netRecvBytesPerSec: number }[] }>(res)
    expect(data.points[0]!.netSentBytesPerSec).toBe(0.5 * 1024 * 1024)
    expect(data.points[0]!.netRecvBytesPerSec).toBe(0.25 * 1024 * 1024)
  })

  test('an empty window is ok with no points and a note, not an error', async () => {
    stubHub({ containerStats: [] })
    const res = await containerMetricsGetCmd.run(ctx({ system: 'boris', container: 'caddy' }))
    const data = dataOf<{ points: unknown[]; note: string }>(res)
    expect(data.points).toEqual([])
    expect(data.note).toContain('no container_stats samples')
  })

  test('overflow sets truncated and keeps the most recent records', async () => {
    stubHub({ containerStats: [CONTAINER_STATS_1M, CONTAINER_STATS_1M_OLDER] })
    const res = await containerMetricsGetCmd.run(ctx({ system: 'boris', container: 'beszel', max: 1 }))
    const data = dataOf<{ truncated: boolean; points: { timestamp: string }[] }>(res)
    expect(data.truncated).toBe(true)
    expect(data.points).toHaveLength(1)
    expect(data.points[0]!.timestamp).toBe('2026-07-17T09:59:00.000Z')
  })
})

describe('smart get', () => {
  test('returns normalized devices sorted by the hub', async () => {
    stubHub({ smartDevices: [SMART_NVME, SMART_SATA] })
    const res = await smartGetCmd.run(ctx({ system: 'boris' }))
    const data = dataOf<{ devices: Record<string, unknown>[]; note?: string }>(res)
    expect(data.note).toBeUndefined()
    expect(data.devices).toHaveLength(2)
    expect(data.devices[0]).toMatchObject({
      name: 'nvme0n1',
      model: 'Samsung SSD 990 PRO 1TB',
      state: 'PASSED',
      type: 'nvme',
      capacityBytes: 1000204886016,
      temperatureC: 41,
      powerOnHours: 8760,
      powerCycles: 456,
      updatedAt: '2026-07-17T09:30:00.000Z',
    })
    expect(data.devices[0]!.attributes).toEqual([
      expect.objectContaining({ name: 'PowerOnHours', rawValue: 8760 }),
      expect.objectContaining({ name: 'PowerCycles', rawValue: 456 }),
      expect.objectContaining({ name: 'PercentageUsed', rawValue: 3 }),
    ])
    expect(paramsOf('smart_devices')?.get('filter')).toBe('system="sysaaaaaaaaaaaa1"')
    expect(paramsOf('smart_devices')?.get('sort')).toBe('name')
  })

  test('a system with no SMART devices is ok with an empty list and a note', async () => {
    stubHub({ smartDevices: [] })
    const res = await smartGetCmd.run(ctx({ system: 'boris' }))
    const data = dataOf<{ devices: unknown[]; note: string }>(res)
    expect(data.devices).toEqual([])
    expect(data.note).toContain('no SMART devices reported for boris')
  })

  test('a hub without the smart_devices collection is ok-empty, not an error', async () => {
    stubHub({}) // smart_devices undefined → the stub 404s it like PocketBase
    const res = await smartGetCmd.run(ctx({ system: 'boris' }))
    const data = dataOf<{ devices: unknown[]; note: string }>(res)
    expect(data.devices).toEqual([])
    expect(data.note).toContain('no smart_devices collection')
  })
})

describe('pbFilterDate', () => {
  test("matches PocketBase's stored autodate text format", () => {
    expect(pbFilterDate(Date.parse('2026-07-17T09:00:00.000Z'))).toBe('2026-07-17 09:00:00.000Z')
  })
})
