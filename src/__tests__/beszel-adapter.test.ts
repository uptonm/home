import { describe, expect, test } from 'bun:test'
import {
  epochMsToIso,
  normalizeAlert,
  normalizeContainer,
  normalizeSystem,
  normalizeSystemStats,
  pbDateToIso,
} from '../modules/beszel/adapter'
import {
  ALERT_CPU_TRIGGERED,
  ALERT_STATUS_QUIET,
  CONTAINER_CADDY,
  SYSTEM_PENDING,
  SYSTEM_STATS_1M,
  SYSTEM_UP,
} from './beszel-fixtures'

describe('date normalization', () => {
  test('PocketBase space-separated autodate becomes ISO 8601', () => {
    expect(pbDateToIso('2026-07-17 09:59:30.123Z')).toBe('2026-07-17T09:59:30.123Z')
    expect(pbDateToIso('')).toBeNull()
    expect(pbDateToIso(undefined)).toBeNull()
  })

  test('epoch milliseconds become ISO 8601', () => {
    expect(epochMsToIso(1784282370123)).toBe(new Date(1784282370123).toISOString())
    expect(epochMsToIso(0)).toBeNull()
    expect(epochMsToIso('nope')).toBeNull()
  })
})

describe('normalizeSystem (0.18.x)', () => {
  test('maps the systems record onto the stable shape', () => {
    expect(normalizeSystem(SYSTEM_UP)).toEqual({
      id: 'sysaaaaaaaaaaaa1',
      name: 'boris',
      status: 'up',
      host: '10.0.14.60',
      port: '45876',
      agentVersion: '0.18.7',
      uptimeSeconds: 123456,
      cpuPct: 12.4,
      memoryPct: 38.2,
      diskPct: 61.7,
      loadAvg: [0.5, 0.7, 0.9],
      updatedAt: '2026-07-17T09:59:30.123Z',
    })
  })

  test('a pending system with empty info yields nulls, not an error', () => {
    const s = normalizeSystem(SYSTEM_PENDING)
    expect(s.status).toBe('pending')
    expect(s.cpuPct).toBeNull()
    expect(s.agentVersion).toBeNull()
    expect(normalizeSystem({ ...SYSTEM_PENDING, info: {} }).cpuPct).toBeNull()
  })

  test('missing required field → beszel_incompatible_version', () => {
    for (const field of ['id', 'name', 'host', 'status']) {
      const { [field]: _, ...rest } = SYSTEM_UP
      expect(() => normalizeSystem(rest)).toThrow(
        expect.objectContaining({ code: 'beszel_incompatible_version' }),
      )
    }
  })

  test('renamed info metric key → beszel_incompatible_version', () => {
    const { mp: _, ...info } = SYSTEM_UP.info as Record<string, unknown>
    expect(() => normalizeSystem({ ...SYSTEM_UP, info: { ...info, memPercent: 38.2 } })).toThrow(
      expect.objectContaining({ code: 'beszel_incompatible_version' }),
    )
  })

  test('unknown status value → beszel_incompatible_version', () => {
    expect(() => normalizeSystem({ ...SYSTEM_UP, status: 'hibernating' })).toThrow(
      expect.objectContaining({ code: 'beszel_incompatible_version' }),
    )
  })
})

describe('normalizeSystemStats (0.18.x)', () => {
  test('maps the 1m sample with normalized names and units', () => {
    const s = normalizeSystemStats(SYSTEM_STATS_1M)
    expect(s.collectedAt).toBe('2026-07-17T09:59:00.000Z')
    expect(s.cpuPct).toBe(12.4)
    expect(s.memoryGb).toBe(15.6)
    expect(s.memoryUsedGb).toBe(6.1)
    expect(s.swapUsedGb).toBe(0.4)
    expect(s.diskGb).toBe(458.4)
    expect(s.diskPct).toBe(61.7)
    expect(s.diskReadMbPerSec).toBe(1.2)
    expect(s.networkRecvMbPerSec).toBe(0.34)
    expect(s.bandwidthBytesPerSec).toEqual({ sent: 123400, recv: 567800 })
    expect(s.loadAvg).toEqual([0.5, 0.7, 0.9])
    expect(s.temperaturesC).toEqual({ k10temp: 52.0, nvme0: 41.5 })
    expect(s.extraFilesystems).toEqual({ sdb1: { diskGb: 931.5, diskUsedGb: 500.2 } })
  })

  test('missing stats json or renamed core key → beszel_incompatible_version', () => {
    expect(() => normalizeSystemStats({ id: 'x', created: '2026-07-17 09:59:00.000Z' })).toThrow(
      expect.objectContaining({ code: 'beszel_incompatible_version' }),
    )
    const { cpu: _, ...stats } = SYSTEM_STATS_1M.stats as Record<string, unknown>
    expect(() => normalizeSystemStats({ ...SYSTEM_STATS_1M, stats })).toThrow(
      expect.objectContaining({ code: 'beszel_incompatible_version' }),
    )
  })
})

describe('normalizeContainer (0.18.x)', () => {
  test('maps the containers record, decoding health and epoch-ms timestamps', () => {
    expect(normalizeContainer(CONTAINER_CADDY)).toEqual({
      id: 'a1b2c3',
      name: 'caddy',
      systemId: 'sysaaaaaaaaaaaa1',
      image: 'caddy:2',
      status: 'running (2 days)',
      health: 'healthy',
      cpuPct: 0.3,
      memoryMb: 45.2,
      netBytesPerSec: 1234,
      ports: '80/tcp, 443/tcp',
      updatedAt: new Date(1784282370123).toISOString(),
    })
  })

  test('health 0 is "none"; an out-of-range health is null, not a crash', () => {
    expect(normalizeContainer({ ...CONTAINER_CADDY, health: 0 }).health).toBe('none')
    expect(normalizeContainer({ ...CONTAINER_CADDY, health: 9 }).health).toBeNull()
  })

  test('missing id or name → beszel_incompatible_version', () => {
    const { name: _, ...rest } = CONTAINER_CADDY
    expect(() => normalizeContainer(rest)).toThrow(
      expect.objectContaining({ code: 'beszel_incompatible_version' }),
    )
  })
})

describe('normalizeAlert (0.18.x)', () => {
  test('maps type, threshold, and the expanded system name', () => {
    expect(normalizeAlert(ALERT_CPU_TRIGGERED)).toEqual({
      id: 'alertaaaaaaaaaa1',
      type: 'CPU',
      systemId: 'sysaaaaaaaaaaaa1',
      systemName: 'boris',
      triggered: true,
      threshold: 80,
      minMinutes: 10,
      updatedAt: '2026-07-17T08:00:00.000Z',
    })
    expect(normalizeAlert(ALERT_STATUS_QUIET).triggered).toBe(false)
  })

  test('missing expand degrades to a null systemName', () => {
    const { expand: _, ...rest } = ALERT_CPU_TRIGGERED
    expect(normalizeAlert(rest).systemName).toBeNull()
  })

  test('missing system relation → beszel_incompatible_version', () => {
    const { system: _, ...rest } = ALERT_CPU_TRIGGERED
    expect(() => normalizeAlert(rest)).toThrow(
      expect.objectContaining({ code: 'beszel_incompatible_version' }),
    )
  })
})
