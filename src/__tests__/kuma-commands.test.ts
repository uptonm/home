import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import manifest from '../modules/uptime-kuma'
import { pagesGetCmd } from '../modules/uptime-kuma/commands/pages'
import { monitorsGetCmd, monitorsListCmd } from '../modules/uptime-kuma/commands/monitors'
import { incidentsListCmd, maintenancesListCmd } from '../modules/uptime-kuma/commands/incidents'
import { summaryCmd } from '../modules/uptime-kuma/commands/summary'
import { createKumaTransport, readKumaConfig } from '../modules/uptime-kuma/client'
import type { RunContext, RunResult } from '../core/types'
import {
  EMPTY_HEARTBEATS,
  HEARTBEATS,
  MANIFEST_404_BODY,
  MANIFEST_OK,
  MONITOR_CADDY,
  STATUS_PAGE_RESPONSE,
} from './kuma-fixtures'

const CONFIG = { url: 'http://kuma.test', mode: 'public-status', statusPageSlug: 'home' }

function ctx(args: RunContext['args'] = {}, config: RunContext['config'] = CONFIG): RunContext {
  return {
    args,
    json: true,
    quiet: true,
    verbose: false,
    log: null as unknown as RunContext['log'],
    config,
  }
}

function errCode(r: RunResult): string | undefined {
  return r.ok ? undefined : r.code
}

const realFetch = globalThis.fetch
let requests: { url: URL; init?: RequestInit }[] = []

interface FakeKuma {
  page?: unknown
  heartbeats?: unknown
  /** Whether /api/status-page/:slug/manifest.json 404s (page missing) or 200s. */
  pageExists?: boolean
}

/** Serve a fake 1.23.x public status API. The config route for a missing page is
 * never reached in these tests — the transport's manifest probe must stop first
 * (on the real 1.23.x server that route would hang, see status-page-router.js). */
function stubKuma(data: FakeKuma): void {
  const pageExists = data.pageExists ?? true
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    requests.push({ url, init })
    if (url.pathname.startsWith('/api/status-page/heartbeat/')) {
      return json(data.heartbeats ?? HEARTBEATS)
    }
    if (url.pathname.endsWith('/manifest.json')) {
      return pageExists ? json(MANIFEST_OK) : json(MANIFEST_404_BODY, 404)
    }
    if (url.pathname.startsWith('/api/status-page/')) {
      if (!pageExists) throw new Error('config route hit for a missing page — the manifest probe must prevent this')
      return json(data.page ?? STATUS_PAGE_RESPONSE)
    }
    return json({ status: 'fail', msg: 'Not Found' }, 404)
  }) as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function pathsRequested(): string[] {
  return requests.map((r) => r.url.pathname)
}

beforeEach(() => {
  requests = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('pages get', () => {
  test('returns normalized page metadata with a cached-transport freshness marker', async () => {
    stubKuma({})
    const res = await pagesGetCmd.run(ctx())
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.title).toBe('Homelab Status')
    expect((data.groups as { name: string }[]).map((g) => g.name)).toEqual(['Core', 'Media'])
    expect(data.incident).toMatchObject({ title: 'Degraded uploads', createdAt: '2026-07-16T20:00:00.000Z' })
    expect(data.maintenances).toHaveLength(2)
    expect(data.freshness).toEqual({ cachedTransport: true, newestBeatAt: null })
  })

  test('an explicit slug argument overrides the configured one', async () => {
    stubKuma({})
    const res = await pagesGetCmd.run(ctx({ slug: 'public' }))
    expect(res.ok).toBe(true)
    expect(pathsRequested()).toContain('/api/status-page/public')
  })

  test('a missing slug is kuma_page_not_found and never touches the hanging config route', async () => {
    stubKuma({ pageExists: false })
    const res = await pagesGetCmd.run(ctx({ slug: 'nope' }))
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'kuma_page_not_found' })
    expect((res as { message: string }).message).toContain('"nope"')
    expect(pathsRequested()).toEqual(['/api/status-page/nope/manifest.json'])
  })
})

describe('monitors list', () => {
  test('joins page monitors with their latest public beat, latency, and 24h uptime', async () => {
    stubKuma({})
    const res = await monitorsListCmd.run(ctx())
    expect(res.ok).toBe(true)
    const { monitors, freshness } = (res as { data: { monitors: Record<string, unknown>[]; freshness: unknown } }).data
    expect(monitors.map((m) => [m.name, m.status])).toEqual([
      ['caddy', 'up'],
      ['atlas', 'down'],
      ['sonos-bridge', 'maintenance'],
    ])
    expect(monitors[0]).toMatchObject({ latencyMs: 15, lastBeatAt: '2026-07-17T09:22:00.123Z', uptime24hPct: 99.87 })
    // atlas's latest beat is down with no ping
    expect(monitors[1]).toMatchObject({ status: 'down', latencyMs: null, uptime24hPct: 50 })
    expect(freshness).toEqual({ cachedTransport: true, newestBeatAt: '2026-07-17T09:22:00.123Z' })
  })

  test('--status filters on the normalized state', async () => {
    stubKuma({})
    const res = await monitorsListCmd.run(ctx({ status: 'down' }))
    const { monitors } = (res as { data: { monitors: { name: string }[] } }).data
    expect(monitors.map((m) => m.name)).toEqual(['atlas'])
  })

  test('an unknown --status is rejected before any request', async () => {
    stubKuma({})
    expect(errCode(await monitorsListCmd.run(ctx({ status: 'sideways' })))).toBe('bad_arg')
    expect(requests).toHaveLength(0)
  })
})

describe('monitors get resolution', () => {
  test('resolves by exact id and reports the bounded latency summary', async () => {
    stubKuma({})
    const res = await monitorsGetCmd.run(ctx({ monitor: '1' }))
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.name).toBe('caddy')
    expect(data.latency).toEqual({ samples: 3, avgMs: 15, minMs: 12, maxMs: 18 })
    expect(data.beats).toEqual({
      returned: 3,
      oldestAt: '2026-07-17T09:20:00.000Z',
      newestAt: '2026-07-17T09:22:00.123Z',
    })
    expect(data).toMatchObject({ certExpiryDays: 12, validCert: true })
  })

  test('resolves by exact case-insensitive name', async () => {
    stubKuma({})
    const res = await monitorsGetCmd.run(ctx({ monitor: 'CADDY' }))
    expect((res as { data: { id: string } }).data.id).toBe('1')
  })

  test('never picks between ambiguous names — lists candidates with a stable code', async () => {
    stubKuma({
      page: {
        ...STATUS_PAGE_RESPONSE,
        publicGroupList: [
          { id: 1, name: 'Core', weight: 1, monitorList: [MONITOR_CADDY] },
          { id: 2, name: 'Media', weight: 2, monitorList: [{ ...MONITOR_CADDY, id: 9, name: 'Caddy' }] },
        ],
      },
    })
    const res = await monitorsGetCmd.run(ctx({ monitor: 'caddy' }))
    expect(errCode(res)).toBe('ambiguous')
    const message = (res as { message: string }).message
    expect(message).toContain('id 1')
    expect(message).toContain('id 9')
  })

  test('no substring matching: a partial name is not_found', async () => {
    stubKuma({})
    expect(errCode(await monitorsGetCmd.run(ctx({ monitor: 'cad' })))).toBe('not_found')
  })
})

describe('incidents + maintenances', () => {
  test('incidents list wraps the single pinned incident', async () => {
    stubKuma({})
    const res = await incidentsListCmd.run(ctx())
    const { incidents } = (res as { data: { incidents: { id: number }[] } }).data
    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({ id: 7, style: 'warning' })
  })

  test('no pinned incident → empty list, still ok', async () => {
    stubKuma({ page: { ...STATUS_PAGE_RESPONSE, incident: null } })
    const res = await incidentsListCmd.run(ctx())
    expect((res as { data: { incidents: unknown[] } }).data.incidents).toEqual([])
  })

  test('maintenances list normalizes single-strategy timeslots via the window offset', async () => {
    stubKuma({})
    const res = await maintenancesListCmd.run(ctx())
    const { maintenances } = (res as { data: { maintenances: { timeslots: unknown[] }[] } }).data
    expect(maintenances[0]!.timeslots).toEqual([
      { startsAt: '2026-07-20T06:00:00.000Z', endsAt: '2026-07-20T08:00:00.000Z' },
    ])
  })
})

describe('summary', () => {
  test('counts by state, worst state, avg latency of latest beats, freshness', async () => {
    stubKuma({})
    const res = await summaryCmd.run(ctx())
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.monitors).toEqual({ total: 3, up: 1, down: 1, pending: 0, maintenance: 1, unknown: 0 })
    expect(data.worst).toBe('down')
    // latest beats with a ping: caddy 15, sonos-bridge 22 (atlas's down beat has none)
    expect(data.avgLatencyMs).toBe(18.5)
    expect(data.freshness).toEqual({ cachedTransport: true, newestBeatAt: '2026-07-17T09:22:00.123Z' })
    expect(pathsRequested()).toEqual(['/api/status-page/heartbeat/home'])
  })

  test('an empty-but-existing page is data, disambiguated with one manifest probe', async () => {
    stubKuma({ heartbeats: EMPTY_HEARTBEATS, pageExists: true })
    const res = await summaryCmd.run(ctx())
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.monitors).toMatchObject({ total: 0 })
    expect(data.worst).toBeNull()
    expect(data.freshness).toEqual({ cachedTransport: true, newestBeatAt: null })
    expect(pathsRequested()).toEqual(['/api/status-page/heartbeat/home', '/api/status-page/home/manifest.json'])
  })

  test('an empty heartbeat payload for a missing slug is kuma_page_not_found', async () => {
    stubKuma({ heartbeats: EMPTY_HEARTBEATS, pageExists: false })
    const res = await summaryCmd.run(ctx())
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'kuma_page_not_found' })
  })
})

describe('mode + config gates', () => {
  test('mode=authenticated-socket is rejected at the transport seam with kuma_mode_unsupported', () => {
    let code: string | undefined
    try {
      createKumaTransport(readKumaConfig({ ...CONFIG, mode: 'authenticated-socket' }))
    } catch (err) {
      code = (err as { code?: string }).code
    }
    expect(code).toBe('kuma_mode_unsupported')
  })

  test('a command under authenticated-socket fails as a user error before any request', async () => {
    stubKuma({})
    const res = await summaryCmd.run(ctx({}, { ...CONFIG, mode: 'authenticated-socket' }))
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'kuma_mode_unsupported' })
    expect(requests).toHaveLength(0)
  })

  test('public-status without a statusPageSlug is kuma_not_configured', async () => {
    stubKuma({})
    const res = await summaryCmd.run(ctx({}, { url: 'http://kuma.test', mode: 'public-status' }))
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'kuma_not_configured' })
  })

  test('insecureTLS is plumbed into the fetch TLS options', async () => {
    stubKuma({})
    await summaryCmd.run(ctx({}, { ...CONFIG, insecureTLS: true }))
    const init = requests[0]!.init as { tls?: { rejectUnauthorized?: boolean } }
    expect(init?.tls?.rejectUnauthorized).toBe(false)
  })
})

describe('status()', () => {
  test('reports mode, monitor counts, and freshness from a single heartbeat GET', async () => {
    stubKuma({})
    const res = await manifest.status(CONFIG)
    expect(res.ok).toBe(true)
    const data = (res as { data: Record<string, unknown> }).data
    expect(data.mode).toBe('public-status')
    expect(data.statusPageSlug).toBe('home')
    expect(data.monitors).toMatchObject({ up: 1, down: 1, maintenance: 1 })
    expect(data.worst).toBe('down')
    expect(data.freshness).toEqual({ cachedTransport: true, newestBeatAt: '2026-07-17T09:22:00.123Z' })
    expect(requests).toHaveLength(1)
  })

  test('missing page: config kind, kuma_page_not_found, names the slug, ≤2 GETs', async () => {
    stubKuma({ heartbeats: EMPTY_HEARTBEATS, pageExists: false })
    const res = await manifest.status(CONFIG)
    expect(res).toMatchObject({ ok: false, kind: 'config', code: 'kuma_page_not_found' })
    const message = (res as { message: string }).message
    expect(message).toContain('"home"')
    expect(message).toContain('reachable')
    expect(requests).toHaveLength(2)
  })

  test('instance down: system kind, kuma_unreachable — distinct from a missing page', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed: connection refused')
    }) as unknown as typeof fetch
    const res = await manifest.status(CONFIG)
    expect(res).toMatchObject({ ok: false, kind: 'system', code: 'kuma_unreachable' })
  }, 15_000)

  test('unsupported mode surfaces as config with kuma_mode_unsupported', async () => {
    const res = await manifest.status({ ...CONFIG, mode: 'authenticated-socket' })
    expect(res).toMatchObject({ ok: false, kind: 'config', code: 'kuma_mode_unsupported' })
  })

  test('unconfigured module reports config kind', async () => {
    const res = await manifest.status({})
    expect(res).toMatchObject({ ok: false, kind: 'config', code: 'kuma_not_configured' })
  })
})
