import { afterEach, describe, expect, test } from 'bun:test'
import manifest from '../modules/uptime-kuma'
import { pagesGetCmd } from '../modules/uptime-kuma/commands/pages'
import { monitorsGetCmd, monitorsListCmd } from '../modules/uptime-kuma/commands/monitors'
import { incidentsListCmd, maintenancesListCmd } from '../modules/uptime-kuma/commands/incidents'
import { summaryCmd } from '../modules/uptime-kuma/commands/summary'
import { heartbeatsListCmd } from '../modules/uptime-kuma/commands/heartbeats'
import { certificatesListCmd } from '../modules/uptime-kuma/commands/certificates'
import {
  setKumaSocketOverrides,
  type KumaSocketConnect,
  type KumaSocketLike,
} from '../modules/uptime-kuma/socket'
import type { RawHeartbeat } from '../modules/uptime-kuma/client'
import type { RunContext, RunResult } from '../core/types'
import {
  INFO_POST_LOGIN,
  INFO_PRE_AUTH,
  LOGIN_2FA,
  LOGIN_BAD,
  LOGIN_OK,
  SOCKET_BEATS,
  SOCKET_CERTS,
  SOCKET_MAINTENANCE_LIST,
  SOCKET_MONITOR_LIST,
  SOCKET_UPTIME_24,
} from './kuma-socket-fixtures'

const AUTH_CONFIG = {
  url: 'http://kuma.test',
  mode: 'authenticated-socket',
  username: 'admin',
  password: 'correct horse',
}

const PUBLIC_CONFIG = { url: 'http://kuma.test', mode: 'public-status', statusPageSlug: 'home' }

function ctx(args: RunContext['args'] = {}, config: RunContext['config'] = AUTH_CONFIG): RunContext {
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

function dataOf(r: RunResult): Record<string, unknown> {
  expect(r.ok).toBe(true)
  return (r as { data: Record<string, unknown> }).data
}

interface FakeKumaOptions {
  loginResponse?: unknown
  version?: string | null
  monitors?: Record<string, Record<string, unknown>>
  beats?: Record<string, RawHeartbeat[]>
  uptime24?: Record<string, number>
  omitUptimeFor?: string[]
  certs?: Record<string, string>
  maintenances?: Record<string, unknown>
  connectError?: string
  neverConnect?: boolean
  neverAckLogin?: boolean
  omitMonitorList?: boolean
}

/** Replays the 1.23.x connection + afterLogin sequence (see kuma-socket-fixtures provenance). */
class FakeKumaSocket implements KumaSocketLike {
  disconnected = false
  emitted: { event: string; payload: unknown }[] = []
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  constructor(private opts: FakeKumaOptions) {}

  on(event: string, listener: (...args: unknown[]) => void): void {
    const arr = this.listeners.get(event) ?? []
    arr.push(listener)
    this.listeners.set(event, arr)
  }

  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  emit(event: string, payload: unknown, ack: (response: unknown) => void): void {
    this.emitted.push({ event, payload })
    if (event !== 'login' || this.opts.neverAckLogin) return
    const response = this.opts.loginResponse ?? LOGIN_OK
    ack(response)
    if ((response as { ok?: unknown }).ok === true) this.sendBurst()
  }

  disconnect(): void {
    this.disconnected = true
  }

  open(): void {
    if (this.opts.neverConnect) return
    if (this.opts.connectError) {
      this.fire('connect_error', new Error(this.opts.connectError))
      return
    }
    this.fire('connect')
    this.fire('info', INFO_PRE_AUTH)
  }

  private sendBurst(): void {
    if (!this.opts.omitMonitorList) this.fire('monitorList', this.opts.monitors ?? SOCKET_MONITOR_LIST)
    const version = this.opts.version === undefined ? INFO_POST_LOGIN.version : this.opts.version
    if (version !== null) this.fire('info', { ...INFO_POST_LOGIN, version, latestVersion: version })
    this.fire('maintenanceList', this.opts.maintenances ?? SOCKET_MAINTENANCE_LIST)
    for (const [id, rows] of Object.entries(this.opts.beats ?? SOCKET_BEATS)) {
      this.fire('heartbeatList', Number(id), rows, false)
    }
    for (const [id, ratio] of Object.entries(this.opts.uptime24 ?? SOCKET_UPTIME_24)) {
      if (this.opts.omitUptimeFor?.includes(id)) continue
      this.fire('uptime', Number(id), 24, ratio)
      this.fire('uptime', Number(id), 720, ratio)
    }
    for (const [id, infoJson] of Object.entries(this.opts.certs ?? SOCKET_CERTS)) {
      this.fire('certInfo', Number(id), infoJson)
    }
  }
}

function stubSocket(opts: FakeKumaOptions = {}): FakeKumaSocket[] {
  const sockets: FakeKumaSocket[] = []
  const connect: KumaSocketConnect = () => {
    const socket = new FakeKumaSocket(opts)
    sockets.push(socket)
    queueMicrotask(() => socket.open())
    return socket
  }
  setKumaSocketOverrides({
    connect,
    timings: { connectMs: 300, loginMs: 300, settleCapMs: 150, settleGraceMs: 1 },
  })
  return sockets
}

afterEach(() => {
  setKumaSocketOverrides(null)
})

describe('login', () => {
  test('sends the 1.23.x login payload shape: {username, password, token: null}', async () => {
    const sockets = stubSocket()
    const res = await summaryCmd.run(ctx())
    expect(res.ok).toBe(true)
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.emitted).toEqual([
      { event: 'login', payload: { username: 'admin', password: 'correct horse', token: null } },
    ])
  })

  test('2FA accounts are refused with kuma_2fa_unsupported and the socket is closed', async () => {
    const sockets = stubSocket({ loginResponse: LOGIN_2FA })
    const res = await summaryCmd.run(ctx())
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'kuma_2fa_unsupported' })
    expect(sockets[0]!.disconnected).toBe(true)
  })

  test('bad credentials are kuma_auth_failed carrying the bounded server message', async () => {
    const sockets = stubSocket({ loginResponse: LOGIN_BAD })
    const res = await summaryCmd.run(ctx())
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'kuma_auth_failed' })
    expect((res as { message: string }).message).toContain('Incorrect username or password.')
    expect(sockets[0]!.disconnected).toBe(true)
  })

  // Socket failures are SystemErrors: like the public transport's
  // kuma_unreachable, they propagate to the citty wrapper rather than
  // returning a user-kind RunResult.
  test('a login that never acks fails as kuma_socket_failed within the bound, socket closed', async () => {
    const sockets = stubSocket({ neverAckLogin: true })
    await expect(summaryCmd.run(ctx())).rejects.toMatchObject({ code: 'kuma_socket_failed' })
    expect(sockets[0]!.disconnected).toBe(true)
  })

  test('connect_error is kuma_unreachable, socket closed', async () => {
    const sockets = stubSocket({ connectError: 'xhr poll error' })
    await expect(summaryCmd.run(ctx())).rejects.toMatchObject({ code: 'kuma_unreachable' })
    expect(sockets[0]!.disconnected).toBe(true)
  })

  test('a connection that never establishes times out as kuma_unreachable', async () => {
    const sockets = stubSocket({ neverConnect: true })
    await expect(summaryCmd.run(ctx())).rejects.toMatchObject({ code: 'kuma_unreachable' })
    expect(sockets[0]!.disconnected).toBe(true)
  })
})

describe('version gate', () => {
  test('a server outside the tested 1.23.x series is refused with kuma_untested_version', async () => {
    const sockets = stubSocket({ version: '2.0.1' })
    const res = await summaryCmd.run(ctx())
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'kuma_untested_version' })
    expect((res as { message: string }).message).toContain('2.0.1')
    expect(sockets[0]!.disconnected).toBe(true)
  })

  test('1.24 is outside the tested series too', async () => {
    stubSocket({ version: '1.24.0' })
    expect(errCode(await summaryCmd.run(ctx()))).toBe('kuma_untested_version')
  })

  test('allowUnsupported: true lets an untested version through', async () => {
    stubSocket({ version: '2.0.1' })
    const res = await summaryCmd.run(ctx({}, { ...AUTH_CONFIG, allowUnsupported: true }))
    expect(res.ok).toBe(true)
  })

  test('a burst with no versioned info event is not refused', async () => {
    stubSocket({ version: null })
    expect((await summaryCmd.run(ctx())).ok).toBe(true)
  })
})

describe('initial-burst collection', () => {
  test('one socket session serves a whole command, even across page + heartbeat reads', async () => {
    const sockets = stubSocket()
    const res = await monitorsListCmd.run(ctx())
    expect(res.ok).toBe(true)
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.disconnected).toBe(true)
  })

  test('a burst missing some per-monitor stats still resolves at the settle cap', async () => {
    const sockets = stubSocket({ omitUptimeFor: ['3'] })
    const res = await summaryCmd.run(ctx())
    const data = dataOf(res)
    expect(data.monitors).toMatchObject({ total: 3 })
    expect(sockets[0]!.disconnected).toBe(true)
  })

  test('a session with no monitorList by the cap is kuma_socket_failed', async () => {
    const sockets = stubSocket({ omitMonitorList: true })
    await expect(summaryCmd.run(ctx())).rejects.toMatchObject({ code: 'kuma_socket_failed' })
    expect(sockets[0]!.disconnected).toBe(true)
  })
})

describe('event → normalized mapping', () => {
  test('monitors list joins monitorList, heartbeatList, uptime, and certInfo', async () => {
    stubSocket()
    const data = dataOf(await monitorsListCmd.run(ctx()))
    const monitors = data.monitors as Record<string, unknown>[]
    expect(monitors.map((m) => [m.name, m.status])).toEqual([
      ['caddy', 'up'],
      ['atlas', 'down'],
      ['sonos-bridge', 'maintenance'],
    ])
    expect(monitors[0]).toMatchObject({
      id: '1',
      group: 'all',
      url: 'https://caddy.uptonm.io',
      latencyMs: 15,
      lastBeatAt: '2026-07-17T09:22:00.123Z',
      uptime24hPct: 99.87,
      certExpiryDays: 12,
      validCert: true,
    })
    expect(monitors[1]).toMatchObject({ certExpiryDays: -46, validCert: false })
    expect(monitors[2]).toMatchObject({ url: null, certExpiryDays: null, validCert: null })
    expect(data.freshness).toEqual({ cachedTransport: false, newestBeatAt: '2026-07-17T09:22:00.123Z' })
  })

  test('pages get returns the synthesized all-monitors page with normalized maintenances', async () => {
    stubSocket()
    const data = dataOf(await pagesGetCmd.run(ctx()))
    expect(data.title).toBe('All monitors (authenticated)')
    expect((data.groups as { name: string; monitors: unknown[] }[]).map((g) => [g.name, g.monitors.length])).toEqual([
      ['all', 3],
    ])
    expect(data.incident).toBeNull()
    expect(data.maintenances).toHaveLength(2)
    expect(data.freshness).toEqual({ cachedTransport: false, newestBeatAt: null })
  })

  test('maintenances list carries every window with its status and ISO timeslots', async () => {
    stubSocket()
    const data = dataOf(await maintenancesListCmd.run(ctx()))
    const maintenances = data.maintenances as { id: number; status: string; timeslots: unknown[] }[]
    expect(maintenances.map((m) => m.id)).toEqual([4, 5])
    expect(maintenances[0]!.timeslots).toEqual([
      { startsAt: '2026-07-20T06:00:00.000Z', endsAt: '2026-07-20T08:00:00.000Z' },
    ])
  })

  test('incidents list is empty in auth mode and says why', async () => {
    stubSocket()
    const data = dataOf(await incidentsListCmd.run(ctx()))
    expect(data.incidents).toEqual([])
    expect(String(data.note)).toContain('public status pages')
  })

  test('summary counts by latest-beat state with a live-transport freshness marker', async () => {
    stubSocket()
    const data = dataOf(await summaryCmd.run(ctx()))
    expect(data.monitors).toEqual({ total: 3, up: 1, down: 1, pending: 0, maintenance: 1, unknown: 0 })
    expect(data.worst).toBe('down')
    expect(data.freshness).toEqual({ cachedTransport: false, newestBeatAt: '2026-07-17T09:22:00.123Z' })
  })

  test('monitors get resolves by name against the private inventory', async () => {
    stubSocket()
    const data = dataOf(await monitorsGetCmd.run(ctx({ monitor: 'atlas' })))
    expect(data.id).toBe('2')
    expect(data).toMatchObject({ status: 'down', certExpiryDays: -46, validCert: false })
  })

  test('status() reports auth mode with live freshness', async () => {
    stubSocket()
    const res = await manifest.status(AUTH_CONFIG)
    const data = dataOf(res)
    expect(data.mode).toBe('authenticated-socket')
    expect(data.statusPageSlug).toBeNull()
    expect(data.worst).toBe('down')
    expect((data.freshness as { cachedTransport: boolean }).cachedTransport).toBe(false)
  })
})

describe('heartbeats list', () => {
  test('returns normalized beats with the down reason msg the public route blanks', async () => {
    stubSocket()
    const data = dataOf(await heartbeatsListCmd.run(ctx({ monitor: 'atlas' })))
    expect(data.monitor).toEqual({ id: '2', name: 'atlas', type: 'http', url: 'https://atlas.uptonm.io' })
    expect(data.beats).toEqual([
      { status: 'up', at: '2026-07-17T09:20:30.000Z', latencyMs: 40, msg: '200 - OK' },
      { status: 'down', at: '2026-07-17T09:21:30.000Z', latencyMs: null, msg: 'connect ECONNREFUSED 10.0.14.60:8090' },
    ])
    expect(data.latency).toEqual({ samples: 1, avgMs: 40, minMs: 40, maxMs: 40 })
    expect(data.freshness).toEqual({ cachedTransport: false, newestBeatAt: '2026-07-17T09:21:30.000Z' })
  })

  test('--limit keeps the newest beats', async () => {
    stubSocket()
    const data = dataOf(await heartbeatsListCmd.run(ctx({ monitor: 'caddy', limit: 2 })))
    const beats = data.beats as { at: string }[]
    expect(beats.map((b) => b.at)).toEqual(['2026-07-17T09:21:00.000Z', '2026-07-17T09:22:00.123Z'])
    expect(data).toMatchObject({ returned: 2, available: 3 })
  })

  test('--since drops beats before the timestamp', async () => {
    stubSocket()
    const data = dataOf(
      await heartbeatsListCmd.run(ctx({ monitor: 'caddy', since: '2026-07-17T09:21:30.000Z' })),
    )
    expect((data.beats as { at: string }[]).map((b) => b.at)).toEqual(['2026-07-17T09:22:00.123Z'])
  })

  test('nonsense --since and --limit are user errors before any connection', async () => {
    const sockets = stubSocket()
    expect(errCode(await heartbeatsListCmd.run(ctx({ monitor: 'caddy', since: 'yesterday-ish' })))).toBe('bad_arg')
    expect(errCode(await heartbeatsListCmd.run(ctx({ monitor: 'caddy', limit: -3 })))).toBe('bad_arg')
    expect(sockets).toHaveLength(0)
  })

  test('public mode is rejected with kuma_auth_mode_required naming the mode', async () => {
    const res = await heartbeatsListCmd.run(ctx({ monitor: 'caddy' }, PUBLIC_CONFIG))
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'kuma_auth_mode_required' })
    expect((res as { message: string }).message).toContain('public-status')
  })
})

describe('certificates list', () => {
  test('lists stored certs sorted soonest-expiry first, joined to monitor names', async () => {
    stubSocket()
    const data = dataOf(await certificatesListCmd.run(ctx()))
    expect(data.certificates).toEqual([
      {
        monitorId: '2',
        monitorName: 'atlas',
        valid: false,
        daysRemaining: -46,
        validTo: '2026-06-01T00:00:00.000Z',
        subjectCN: 'atlas.uptonm.io',
        issuer: 'atlas.uptonm.io',
        certType: 'self signed',
      },
      {
        monitorId: '1',
        monitorName: 'caddy',
        valid: true,
        daysRemaining: 12,
        validTo: '2026-07-29T12:00:00.000Z',
        subjectCN: 'caddy.uptonm.io',
        issuer: "Let's Encrypt",
        certType: 'server',
      },
    ])
    expect(data.freshness).toEqual({ cachedTransport: false, newestBeatAt: null })
  })

  test('--days keeps certs expiring within the window; invalid certs always stay', async () => {
    stubSocket()
    const data = dataOf(await certificatesListCmd.run(ctx({ days: 5 })))
    // caddy (12 days) filtered out; atlas kept despite -46 because it is invalid
    expect((data.certificates as { monitorId: string }[]).map((c) => c.monitorId)).toEqual(['2'])
  })

  test('--days 30 keeps both', async () => {
    stubSocket()
    const data = dataOf(await certificatesListCmd.run(ctx({ days: 30 })))
    expect(data.certificates as unknown[]).toHaveLength(2)
  })

  test('public mode is rejected with kuma_auth_mode_required', async () => {
    const res = await certificatesListCmd.run(ctx({}, PUBLIC_CONFIG))
    expect(res).toMatchObject({ ok: false, kind: 'user', code: 'kuma_auth_mode_required' })
  })
})
