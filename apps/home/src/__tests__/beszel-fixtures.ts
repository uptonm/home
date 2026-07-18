/**
 * Fixture provenance — derived from the Beszel v0.18.7 source tree
 * (github.com/henrygd/beszel @ tag v0.18.7), not captured from a live hub:
 *
 *  - Collection/field inventory: internal/migrations/0_collections_snapshot_0_19_0_dev_1.go
 *    (systems, system_stats, container_stats, containers, alerts, alerts_history,
 *    smart_devices, system_details, systemd_services, fingerprints, users)
 *  - `systems.info` JSON keys: internal/entities/system/system.go `Info` struct
 *    (u uptime s, cpu %, mp mem %, dp disk %, v agent version, la loadavg, dt temp)
 *  - `system_stats.stats` JSON keys: same file, `Stats` struct (m/mu GB, d/du GB,
 *    dr/dw MB/s, ns/nr MB/s, b [sent,recv] bytes/s, t temps °C, efs extra filesystems)
 *  - `containers` columns: internal/hub/systems/system.go `createContainerRecords`
 *    (memory MB, net bytes/s, updated epoch ms, health 0–3 per entities/container)
 *  - Auth errors: PocketBase apis/record_auth_with_password.go — 400 "Failed to
 *    authenticate." for bad credentials; "The collection is not configured to allow
 *    password authentication." when the hub sets DISABLE_PASSWORD_AUTH
 *    (internal/hub/collections.go)
 */
import type { RawRecord } from '../modules/beszel/client'

export const SYSTEM_UP: RawRecord = {
  id: 'sysaaaaaaaaaaaa1',
  collectionName: 'systems',
  name: 'boris',
  status: 'up',
  host: '10.0.14.60',
  port: '45876',
  info: {
    h: 'boris',
    k: '7.0.0-22-generic',
    c: 8,
    t: 16,
    m: 'AMD Ryzen 7',
    u: 123456,
    cpu: 12.4,
    mp: 38.2,
    dp: 61.7,
    v: '0.18.7',
    bb: 12345,
    la: [0.5, 0.7, 0.9],
    os: 0,
    dt: 42.1,
  },
  users: ['useraaaaaaaaaaa1'],
  created: '2026-06-01 10:00:00.000Z',
  updated: '2026-07-17 09:59:30.123Z',
}

export const SYSTEM_DOWN: RawRecord = {
  id: 'sysbbbbbbbbbbbb2',
  collectionName: 'systems',
  name: 'atlas',
  status: 'down',
  host: '10.0.14.61',
  port: '45876',
  info: { u: 99, cpu: 0.5, mp: 10.1, dp: 20.2, v: '0.18.6', la: [0, 0, 0] },
  users: ['useraaaaaaaaaaa1'],
  created: '2026-06-01 10:00:00.000Z',
  updated: '2026-07-16 22:00:00.000Z',
}

/** A system whose agent has never reported: status pending, info still empty. */
export const SYSTEM_PENDING: RawRecord = {
  id: 'syscccccccccccc3',
  name: 'new-box',
  status: 'pending',
  host: '10.0.14.62',
  port: '45876',
  info: null,
  users: ['useraaaaaaaaaaa1'],
  created: '2026-07-17 09:00:00.000Z',
  updated: '2026-07-17 09:00:00.000Z',
}

export const SYSTEM_STATS_1M: RawRecord = {
  id: 'statsaaaaaaaaaa1',
  system: 'sysaaaaaaaaaaaa1',
  type: '1m',
  created: '2026-07-17 09:59:00.000Z',
  updated: '2026-07-17 09:59:00.000Z',
  stats: {
    cpu: 12.4,
    m: 15.6,
    mu: 6.1,
    mp: 38.2,
    mb: 2.5,
    s: 4,
    su: 0.4,
    d: 458.4,
    du: 283.1,
    dp: 61.7,
    dr: 1.2,
    dw: 3.4,
    ns: 0.12,
    nr: 0.34,
    b: [123400, 567800],
    la: [0.5, 0.7, 0.9],
    t: { k10temp: 52.0, nvme0: 41.5 },
    efs: { sdb1: { d: 931.5, du: 500.2, r: 0, w: 0, rb: 0, wb: 0 } },
  },
}

export const CONTAINER_CADDY: RawRecord = {
  id: 'a1b2c3',
  system: 'sysaaaaaaaaaaaa1',
  name: 'caddy',
  status: 'running (2 days)',
  health: 2,
  cpu: 0.3,
  memory: 45.2,
  net: 1234,
  image: 'caddy:2',
  ports: '80/tcp, 443/tcp',
  updated: 1784282370123,
}

export const CONTAINER_BESZEL: RawRecord = {
  id: 'd4e5f6',
  system: 'sysaaaaaaaaaaaa1',
  name: 'beszel',
  status: 'running (5 days)',
  health: 0,
  cpu: 1.1,
  memory: 120.5,
  net: 890,
  image: 'henrygd/beszel:0.18.7',
  ports: '8090/tcp',
  updated: 1784282370123,
}

/**
 * container_stats provenance (v0.18.7): the record's `stats` json is an ARRAY of
 * per-container entries. internal/hub/systems/system.go `createRecords` sets
 * `containerStatsRecord.Set("stats", data.Containers)` where data.Containers is
 * []*container.Stats (internal/entities/container/container.go): n name, c cpu %,
 * m memory MB, b [sent, recv] bytes/s (added 0.18.3), ns/nr deprecated MB/s kept
 * for pre-0.18.3 agents/records; health/status/id/image/ports are json:"-" and
 * therefore absent. Same 1m/10m/20m/120m/480m `type` select as system_stats
 * (migration snapshot 0_collections_snapshot_0_19_0_dev_1.go).
 */
export const CONTAINER_STATS_1M: RawRecord = {
  id: 'cstataaaaaaaaaa1',
  system: 'sysaaaaaaaaaaaa1',
  type: '1m',
  created: '2026-07-17 09:59:00.000Z',
  updated: '2026-07-17 09:59:00.000Z',
  stats: [
    { n: 'caddy', c: 0.3, m: 45.2, b: [1200, 3400] },
    // pre-0.18.3 record shape: deprecated ns/nr MB/s only, no `b`
    { n: 'beszel', c: 1.1, m: 120.5, ns: 0.5, nr: 0.25 },
  ],
}

/** Older sample where caddy was not running — its entry is simply absent. */
export const CONTAINER_STATS_1M_OLDER: RawRecord = {
  id: 'cstatbbbbbbbbbb2',
  system: 'sysaaaaaaaaaaaa1',
  type: '1m',
  created: '2026-07-17 09:58:00.000Z',
  updated: '2026-07-17 09:58:00.000Z',
  stats: [{ n: 'beszel', c: 0.9, m: 118, b: [800, 1600] }],
}

/**
 * smart_devices provenance (v0.18.7): columns from the migration snapshot
 * (system/name/model/state/capacity/temp/firmware/serial/type/hours/cycles/
 * attributes/updated — note there is NO `created` column). Values written by
 * internal/hub/systems/system_smart.go `upsertSmartDeviceRecord`: state is
 * smartctl's SmartStatus string (PASSED/FAILED), capacity bytes, temp °C,
 * hours/cycles extracted from the attribute table. `attributes` entries are
 * entities/smart `SmartAttribute` json: {id, n, v, w, t, rv, rs, wf}.
 */
export const SMART_NVME: RawRecord = {
  id: 'smartaaaaaaaaaa1',
  system: 'sysaaaaaaaaaaaa1',
  name: 'nvme0n1',
  model: 'Samsung SSD 990 PRO 1TB',
  state: 'PASSED',
  capacity: 1000204886016,
  temp: 41,
  firmware: '4B2QJXD7',
  serial: 'S6Z1NJ0T123456',
  type: 'nvme',
  hours: 8760,
  cycles: 456,
  // NVMe attributes are synthesized from the health log — no id/value/worst/threshold
  attributes: [
    { n: 'PowerOnHours', rv: 8760, rs: '8760' },
    { n: 'PowerCycles', rv: 456, rs: '456' },
    { n: 'PercentageUsed', rv: 3, rs: '3' },
  ],
  updated: '2026-07-17 09:30:00.000Z',
}

export const SMART_SATA: RawRecord = {
  id: 'smartbbbbbbbbbb2',
  system: 'sysaaaaaaaaaaaa1',
  name: 'sda',
  model: 'WDC WD40EFRX-68N32N0',
  state: 'PASSED',
  capacity: 4000787030016,
  temp: 34,
  firmware: '82.00A82',
  serial: 'WD-WCC7K1234567',
  type: 'sat',
  hours: 41000,
  cycles: 120,
  attributes: [
    { id: 5, n: 'Reallocated_Sector_Ct', v: 200, w: 200, t: 140, rv: 0, rs: '0' },
    { id: 9, n: 'Power_On_Hours', v: 44, w: 44, t: 0, rv: 41000, rs: '41000' },
    { id: 194, n: 'Temperature_Celsius', v: 116, w: 95, t: 0, rv: 34, rs: '34' },
  ],
  updated: '2026-07-17 09:30:00.000Z',
}

export const ALERT_CPU_TRIGGERED: RawRecord = {
  id: 'alertaaaaaaaaaa1',
  user: 'useraaaaaaaaaaa1',
  system: 'sysaaaaaaaaaaaa1',
  name: 'CPU',
  value: 80,
  min: 10,
  triggered: true,
  created: '2026-07-01 00:00:00.000Z',
  updated: '2026-07-17 08:00:00.000Z',
  expand: { system: { id: 'sysaaaaaaaaaaaa1', name: 'boris' } },
}

export const ALERT_STATUS_QUIET: RawRecord = {
  id: 'alertbbbbbbbbbb2',
  user: 'useraaaaaaaaaaa1',
  system: 'sysbbbbbbbbbbbb2',
  name: 'Status',
  value: 0,
  min: 0,
  triggered: false,
  created: '2026-07-01 00:00:00.000Z',
  updated: '2026-07-10 08:00:00.000Z',
  expand: { system: { id: 'sysbbbbbbbbbbbb2', name: 'atlas' } },
}

export function pbPage(items: RawRecord[], overrides: Partial<{ page: number; totalItems: number; totalPages: number }> = {}) {
  return {
    page: overrides.page ?? 1,
    perPage: items.length,
    totalItems: overrides.totalItems ?? items.length,
    totalPages: overrides.totalPages ?? 1,
    items,
  }
}
