import { describe, expect, test } from 'bun:test'
import {
  SMART_ATTRIBUTES_MAX,
  epochMsToIso,
  normalizeAlert,
  normalizeContainer,
  normalizeContainerStats,
  normalizeSmartDevice,
  normalizeSystem,
  normalizeSystemStats,
  normalizeSystemStatsPoint,
  pbDateToIso,
} from '../modules/beszel/adapter'
import {
  ALERT_CPU_TRIGGERED,
  ALERT_STATUS_QUIET,
  CONTAINER_CADDY,
  CONTAINER_STATS_1M,
  SMART_NVME,
  SMART_SATA,
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

describe('normalizeSystemStatsPoint (0.18.x)', () => {
  test('is the stats shape keyed by timestamp instead of collectedAt', () => {
    const point = normalizeSystemStatsPoint(SYSTEM_STATS_1M)
    expect(point.timestamp).toBe('2026-07-17T09:59:00.000Z')
    expect(point).not.toHaveProperty('collectedAt')
    expect(point.cpuPct).toBe(12.4)
    expect(point.memoryGb).toBe(15.6)
    expect(point.loadAvg).toEqual([0.5, 0.7, 0.9])
  })
})

describe('normalizeContainerStats (0.18.x)', () => {
  test('decodes the per-container entry array, preferring b [sent, recv] bytes/s', () => {
    const record = normalizeContainerStats(CONTAINER_STATS_1M)
    expect(record.timestamp).toBe('2026-07-17T09:59:00.000Z')
    expect(record.containers[0]).toEqual({
      name: 'caddy',
      cpuPct: 0.3,
      memoryMb: 45.2,
      netSentBytesPerSec: 1200,
      netRecvBytesPerSec: 3400,
    })
  })

  test('pre-0.18.3 entries fall back to deprecated ns/nr MB/s × 1024²', () => {
    const record = normalizeContainerStats(CONTAINER_STATS_1M)
    expect(record.containers[1]).toEqual({
      name: 'beszel',
      cpuPct: 1.1,
      memoryMb: 120.5,
      netSentBytesPerSec: 0.5 * 1024 * 1024,
      netRecvBytesPerSec: 0.25 * 1024 * 1024,
    })
  })

  test('an entry with neither b nor ns/nr yields null rates, not zeros', () => {
    const record = normalizeContainerStats({ ...CONTAINER_STATS_1M, stats: [{ n: 'idle', c: 0, m: 1 }] })
    expect(record.containers[0]!.netSentBytesPerSec).toBeNull()
    expect(record.containers[0]!.netRecvBytesPerSec).toBeNull()
  })

  test('non-array stats or a nameless entry → beszel_incompatible_version', () => {
    expect(() => normalizeContainerStats({ ...CONTAINER_STATS_1M, stats: { n: 'caddy' } })).toThrow(
      expect.objectContaining({ code: 'beszel_incompatible_version' }),
    )
    expect(() => normalizeContainerStats({ ...CONTAINER_STATS_1M, stats: [{ c: 1.0 }] })).toThrow(
      expect.objectContaining({ code: 'beszel_incompatible_version' }),
    )
  })
})

describe('normalizeSmartDevice (0.18.x)', () => {
  test('maps the smart_devices record onto the stable shape', () => {
    expect(normalizeSmartDevice(SMART_SATA)).toEqual({
      id: 'smartbbbbbbbbbb2',
      name: 'sda',
      model: 'WDC WD40EFRX-68N32N0',
      serial: 'WD-WCC7K1234567',
      firmware: '82.00A82',
      state: 'PASSED',
      type: 'sat',
      capacityBytes: 4000787030016,
      temperatureC: 34,
      powerOnHours: 41000,
      powerCycles: 120,
      attributes: [
        {
          id: 5,
          name: 'Reallocated_Sector_Ct',
          value: 200,
          worst: 200,
          threshold: 140,
          rawValue: 0,
          rawString: '0',
          whenFailed: null,
        },
        expect.objectContaining({ id: 9, name: 'Power_On_Hours', rawValue: 41000 }),
        expect.objectContaining({ id: 194, name: 'Temperature_Celsius', rawValue: 34 }),
      ],
      updatedAt: '2026-07-17T09:30:00.000Z',
    })
  })

  test('NVMe attributes without id/value/worst/threshold degrade to nulls', () => {
    const device = normalizeSmartDevice(SMART_NVME)
    expect(device.attributes[0]).toEqual({
      id: null,
      name: 'PowerOnHours',
      value: null,
      worst: null,
      threshold: null,
      rawValue: 8760,
      rawString: '8760',
      whenFailed: null,
    })
  })

  test('the attribute table is bounded and malformed rows are dropped, not fatal', () => {
    const attributes = Array.from({ length: SMART_ATTRIBUTES_MAX + 10 }, (_, i) => ({ n: `attr${i}`, rv: i }))
    expect(normalizeSmartDevice({ ...SMART_SATA, attributes }).attributes).toHaveLength(SMART_ATTRIBUTES_MAX)
    const withJunk = normalizeSmartDevice({ ...SMART_SATA, attributes: [{ n: 'ok', rv: 1 }, { rv: 2 }, 'junk'] })
    expect(withJunk.attributes).toEqual([expect.objectContaining({ name: 'ok', rawValue: 1 })])
  })

  test('missing id or name → beszel_incompatible_version', () => {
    const { name: _, ...rest } = SMART_NVME
    expect(() => normalizeSmartDevice(rest)).toThrow(
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
