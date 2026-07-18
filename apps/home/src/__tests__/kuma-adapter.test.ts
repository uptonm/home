import { describe, expect, test } from 'bun:test'
import {
  BEATS_MAX,
  heartbeatStatusToString,
  kumaLocalToIso,
  kumaUtcToIso,
  normalizeBeats,
  normalizeStatusPage,
  summarizeLatency,
  uptimeRatioToPct,
} from '../modules/uptime-kuma/adapter'
import { STATUS_PAGE_RESPONSE, STATUS_PAGE_QUIET, upBeats } from './kuma-fixtures'

describe('heartbeat status ints', () => {
  test('maps the 1.23.x enum: 0 down, 1 up, 2 pending, 3 maintenance', () => {
    expect(heartbeatStatusToString(0)).toBe('down')
    expect(heartbeatStatusToString(1)).toBe('up')
    expect(heartbeatStatusToString(2)).toBe('pending')
    expect(heartbeatStatusToString(3)).toBe('maintenance')
  })

  test('anything outside the enum is null, never a guess', () => {
    expect(heartbeatStatusToString(4)).toBeNull()
    expect(heartbeatStatusToString(-1)).toBeNull()
    expect(heartbeatStatusToString('1')).toBeNull()
    expect(heartbeatStatusToString(undefined)).toBeNull()
  })
})

describe('time normalization', () => {
  test('heartbeat time (UTC with millis) → ISO 8601', () => {
    expect(kumaUtcToIso('2026-07-17 09:22:00.123')).toBe('2026-07-17T09:22:00.123Z')
  })

  test('incident date (UTC without millis) → ISO 8601', () => {
    expect(kumaUtcToIso('2026-07-16 20:00:00')).toBe('2026-07-16T20:00:00.000Z')
  })

  test('already-ISO strings pass through normalized', () => {
    expect(kumaUtcToIso('2026-07-17T09:00:00.000Z')).toBe('2026-07-17T09:00:00.000Z')
  })

  test('garbage and non-strings are null', () => {
    expect(kumaUtcToIso('not a date')).toBeNull()
    expect(kumaUtcToIso(1752743520)).toBeNull()
    expect(kumaUtcToIso(undefined)).toBeNull()
  })

  test('single-strategy maintenance timeslots are anchored by timezoneOffset', () => {
    expect(kumaLocalToIso('2026-07-20 02:00:00', '-04:00')).toBe('2026-07-20T06:00:00.000Z')
  })

  test('ISO timeslots (cron/recurring) ignore the offset', () => {
    expect(kumaLocalToIso('2026-07-17T09:00:00.000Z', '-04:00')).toBe('2026-07-17T09:00:00.000Z')
  })

  test('a missing offset falls back to UTC', () => {
    expect(kumaLocalToIso('2026-07-20 02:00:00', undefined)).toBe('2026-07-20T02:00:00.000Z')
  })
})

describe('uptime ratio', () => {
  test('0..1 ratio becomes a two-decimal percentage', () => {
    expect(uptimeRatioToPct(0.9987)).toBe(99.87)
    expect(uptimeRatioToPct(1)).toBe(100)
    expect(uptimeRatioToPct(0)).toBe(0)
  })

  test('missing ratios are null', () => {
    expect(uptimeRatioToPct(undefined)).toBeNull()
  })
})

describe('normalizeBeats', () => {
  test('normalizes status ints, times, and ping → latencyMs', () => {
    const beats = normalizeBeats([
      { status: 1, time: '2026-07-17 09:20:00.000', msg: '', ping: 12 },
      { status: 0, time: '2026-07-17 09:21:00.000', msg: '', ping: null },
    ])
    expect(beats).toEqual([
      { status: 'up', at: '2026-07-17T09:20:00.000Z', latencyMs: 12 },
      { status: 'down', at: '2026-07-17T09:21:00.000Z', latencyMs: null },
    ])
  })

  test('is bounded: more than BEATS_MAX beats keeps only the newest', () => {
    const beats = normalizeBeats(upBeats(60))
    expect(beats).toHaveLength(BEATS_MAX)
    expect(beats[beats.length - 1]!.at).toBe('2026-07-17T08:00:59.000Z')
    expect(beats[0]!.at).toBe('2026-07-17T08:00:10.000Z')
  })
})

describe('summarizeLatency', () => {
  test('avg/min/max over beats that carry a ping; null pings are skipped', () => {
    const summary = summarizeLatency([
      { status: 'up', at: null, latencyMs: 12 },
      { status: 'up', at: null, latencyMs: 18 },
      { status: 'down', at: null, latencyMs: null },
      { status: 'up', at: null, latencyMs: 15 },
    ])
    expect(summary).toEqual({ samples: 3, avgMs: 15, minMs: 12, maxMs: 18 })
  })

  test('no pings at all → nulls, not NaN', () => {
    expect(summarizeLatency([{ status: 'down', at: null, latencyMs: null }])).toEqual({
      samples: 0,
      avgMs: null,
      minMs: null,
      maxMs: null,
    })
  })
})

describe('normalizeStatusPage', () => {
  test('groups and monitors are normalized with string ids and group names', () => {
    const page = normalizeStatusPage(STATUS_PAGE_RESPONSE)
    expect(page.title).toBe('Homelab Status')
    expect(page.published).toBe(true)
    expect(page.showCertificateExpiry).toBe(true)
    expect(page.groups.map((g) => g.name)).toEqual(['Core', 'Media'])
    const caddy = page.groups[0]!.monitors[0]!
    expect(caddy).toMatchObject({ id: '1', name: 'caddy', group: 'Core', type: 'http', url: null })
  })

  test('cert expiry: days when a valid cert is stored, null when Kuma reports ""', () => {
    const page = normalizeStatusPage(STATUS_PAGE_RESPONSE)
    const [caddy, atlas] = page.groups[0]!.monitors
    expect(caddy).toMatchObject({ certExpiryDays: 12, validCert: true })
    // getCertExpiry returns certExpiryDaysRemaining: "" without valid cert info
    expect(atlas).toMatchObject({ certExpiryDays: null, validCert: false })
    // ping monitor on the same page: cert fields never sent
    expect(page.groups[1]!.monitors[0]).toMatchObject({ certExpiryDays: null, validCert: null })
  })

  test('the pinned incident is normalized with ISO dates', () => {
    const page = normalizeStatusPage(STATUS_PAGE_RESPONSE)
    expect(page.incident).toEqual({
      id: 7,
      style: 'warning',
      title: 'Degraded uploads',
      content: 'Object storage is slow; uploads may time out.',
      createdAt: '2026-07-16T20:00:00.000Z',
      lastUpdatedAt: '2026-07-17T08:30:00.000Z',
    })
  })

  test('maintenance timeslots: single-strategy local dates use the window offset, cron slots pass through', () => {
    const page = normalizeStatusPage(STATUS_PAGE_RESPONSE)
    const [single, cron] = page.maintenances
    expect(single).toMatchObject({ strategy: 'single', status: 'under-maintenance' })
    expect(single!.timeslots).toEqual([{ startsAt: '2026-07-20T06:00:00.000Z', endsAt: '2026-07-20T08:00:00.000Z' }])
    expect(cron!.timeslots).toEqual([{ startsAt: '2026-07-17T09:00:00.000Z', endsAt: '2026-07-17T10:00:00.000Z' }])
  })

  test('a page without incident or maintenance normalizes to null/empty', () => {
    const page = normalizeStatusPage(STATUS_PAGE_QUIET)
    expect(page.incident).toBeNull()
    expect(page.maintenances).toEqual([])
  })

  test('a payload without config is API drift, reported with the stable code', () => {
    let code: string | undefined
    try {
      normalizeStatusPage({ publicGroupList: [] })
    } catch (err) {
      code = (err as { code?: string }).code
    }
    expect(code).toBe('kuma_api_failed')
  })
})
