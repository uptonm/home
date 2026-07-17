/**
 * Normalizers for the Beszel 0.18.x hub schema. Raw PocketBase records never
 * leave this module — commands return only the shapes defined here.
 *
 * Field inventory pinned against the v0.18.7 source (github.com/henrygd/beszel):
 *  - collections/fields: internal/migrations/0_collections_snapshot_0_19_0_dev_1.go
 *  - systems.info JSON keys (h/k/c/t/m/u/cpu/mp/dp/v/la/bb/…): internal/entities/system/system.go `Info`
 *  - system_stats.stats JSON keys (cpu/m/mu/mp/s/su/d/du/dp/dr/dw/ns/nr/b/la/t/efs):
 *    internal/entities/system/system.go `Stats` (memory/disk GB, disk+net rates MB/s,
 *    bandwidth `b` = [sent, recv] bytes/s — agent/system.go)
 *  - containers columns (name/status/health/cpu/memory/net/image/ports/updated):
 *    internal/hub/systems/system.go `createContainerRecords` (memory MB, net bytes/s,
 *    updated epoch ms; health 0–3 per entities/container `DockerHealth`)
 *  - container_stats.stats JSON is an ARRAY of per-container entries: hub's
 *    `createRecords` stores []*container.Stats whole (n name, c cpu %, m memory MB,
 *    b [sent, recv] bytes/s since 0.18.3; ns/nr deprecated MB/s kept for older
 *    records; health/status/id/image/ports are json:"-" and thus absent)
 *  - smart_devices columns (system/name/model/state/capacity/temp/firmware/serial/
 *    type/hours/cycles/attributes/updated — no created): migration snapshot +
 *    internal/hub/systems/system_smart.go `upsertSmartDeviceRecord` (state is
 *    smartctl's PASSED/FAILED, capacity bytes, temp °C); `attributes` entries are
 *    entities/smart `SmartAttribute` json {id, n, v, w, t, rv, rs, wf}
 *  - alerts.name select values: Status/CPU/Memory/Disk/Temperature/Bandwidth/GPU/
 *    LoadAvg1/LoadAvg5/LoadAvg15/Battery
 *
 * A record missing a required field means the hub outgrew this adapter — fail
 * with the stable code `beszel_incompatible_version`, never guess.
 */
import { SystemError } from '../../core/errors'
import type { RawRecord } from './client'

export const SYSTEM_STATUSES = ['up', 'down', 'paused', 'pending'] as const
export type SystemStatus = (typeof SYSTEM_STATUSES)[number]

export const CONTAINER_HEALTHS = ['none', 'starting', 'healthy', 'unhealthy'] as const
export type ContainerHealth = (typeof CONTAINER_HEALTHS)[number]

function incompatible(collection: string, field: string): SystemError {
  return new SystemError(
    `beszel: ${collection} record is missing "${field}" — the hub's schema does not match this adapter (targets 0.18.x)`,
    'beszel_incompatible_version',
  )
}

function requireString(raw: RawRecord, collection: string, field: string): string {
  const v = raw[field]
  if (typeof v !== 'string' || v === '') throw incompatible(collection, field)
  return v
}

function optString(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function optNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** PocketBase autodate strings are `YYYY-MM-DD HH:MM:SS.sssZ`; emit ISO 8601. */
export function pbDateToIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function epochMsToIso(v: unknown): string | null {
  return typeof v === 'number' && v > 0 ? new Date(v).toISOString() : null
}

export interface BeszelSystem {
  id: string
  name: string
  status: SystemStatus
  host: string
  port: string | null
  agentVersion: string | null
  uptimeSeconds: number | null
  cpuPct: number | null
  memoryPct: number | null
  diskPct: number | null
  loadAvg: number[] | null
  updatedAt: string | null
}

export function normalizeSystem(raw: RawRecord): BeszelSystem {
  const id = requireString(raw, 'systems', 'id')
  const name = requireString(raw, 'systems', 'name')
  const host = requireString(raw, 'systems', 'host')
  const status = raw.status
  if (typeof status !== 'string' || !(SYSTEM_STATUSES as readonly string[]).includes(status)) {
    throw incompatible('systems', 'status')
  }

  // `info` is empty until the agent first reports (status "pending").
  const info = raw.info && typeof raw.info === 'object' ? (raw.info as Record<string, unknown>) : null
  const hasInfo = info !== null && Object.keys(info).length > 0
  if (hasInfo) {
    for (const key of ['cpu', 'mp', 'dp'] as const) {
      if (!(key in info)) throw incompatible('systems', `info.${key}`)
    }
  }

  return {
    id,
    name,
    status: status as SystemStatus,
    host,
    port: optString(raw.port),
    agentVersion: hasInfo ? optString(info.v) : null,
    uptimeSeconds: hasInfo ? optNumber(info.u) : null,
    cpuPct: hasInfo ? optNumber(info.cpu) : null,
    memoryPct: hasInfo ? optNumber(info.mp) : null,
    diskPct: hasInfo ? optNumber(info.dp) : null,
    loadAvg: hasInfo && Array.isArray(info.la) ? (info.la as number[]) : null,
    updatedAt: pbDateToIso(raw.updated),
  }
}

export interface BeszelSystemStats {
  collectedAt: string | null
  cpuPct: number | null
  memoryGb: number | null
  memoryUsedGb: number | null
  memoryPct: number | null
  swapGb: number | null
  swapUsedGb: number | null
  diskGb: number | null
  diskUsedGb: number | null
  diskPct: number | null
  diskReadMbPerSec: number | null
  diskWriteMbPerSec: number | null
  networkSentMbPerSec: number | null
  networkRecvMbPerSec: number | null
  bandwidthBytesPerSec: { sent: number; recv: number } | null
  loadAvg: number[] | null
  temperaturesC: Record<string, number> | null
  extraFilesystems: Record<string, { diskGb: number | null; diskUsedGb: number | null }> | null
}

/** Normalize one `system_stats` record (its `stats` JSON is one 1m/10m/… sample). */
export function normalizeSystemStats(raw: RawRecord): BeszelSystemStats {
  const stats = raw.stats && typeof raw.stats === 'object' ? (raw.stats as Record<string, unknown>) : null
  if (!stats) throw incompatible('system_stats', 'stats')
  for (const key of ['cpu', 'mp', 'dp'] as const) {
    if (!(key in stats)) throw incompatible('system_stats', `stats.${key}`)
  }
  const bandwidth = Array.isArray(stats.b) && stats.b.length === 2 ? (stats.b as number[]) : null
  const efs = stats.efs && typeof stats.efs === 'object' ? (stats.efs as Record<string, unknown>) : null
  let extraFilesystems: BeszelSystemStats['extraFilesystems'] = null
  if (efs) {
    extraFilesystems = {}
    for (const [fsName, fsRaw] of Object.entries(efs)) {
      const fs = fsRaw && typeof fsRaw === 'object' ? (fsRaw as Record<string, unknown>) : {}
      extraFilesystems[fsName] = { diskGb: optNumber(fs.d), diskUsedGb: optNumber(fs.du) }
    }
  }
  return {
    collectedAt: pbDateToIso(raw.created),
    cpuPct: optNumber(stats.cpu),
    memoryGb: optNumber(stats.m),
    memoryUsedGb: optNumber(stats.mu),
    memoryPct: optNumber(stats.mp),
    swapGb: optNumber(stats.s),
    swapUsedGb: optNumber(stats.su),
    diskGb: optNumber(stats.d),
    diskUsedGb: optNumber(stats.du),
    diskPct: optNumber(stats.dp),
    diskReadMbPerSec: optNumber(stats.dr),
    diskWriteMbPerSec: optNumber(stats.dw),
    networkSentMbPerSec: optNumber(stats.ns),
    networkRecvMbPerSec: optNumber(stats.nr),
    bandwidthBytesPerSec: bandwidth ? { sent: bandwidth[0] ?? 0, recv: bandwidth[1] ?? 0 } : null,
    loadAvg: Array.isArray(stats.la) ? (stats.la as number[]) : null,
    temperaturesC:
      stats.t && typeof stats.t === 'object' ? (stats.t as Record<string, number>) : null,
    extraFilesystems,
  }
}

export type BeszelSystemStatsPoint = Omit<BeszelSystemStats, 'collectedAt'> & { timestamp: string | null }

/** One history row: the same normalized metrics as `normalizeSystemStats`, keyed by `timestamp`. */
export function normalizeSystemStatsPoint(raw: RawRecord): BeszelSystemStatsPoint {
  const { collectedAt, ...metrics } = normalizeSystemStats(raw)
  return { timestamp: collectedAt, ...metrics }
}

export interface BeszelContainerStatsSample {
  name: string
  cpuPct: number | null
  memoryMb: number | null
  netSentBytesPerSec: number | null
  netRecvBytesPerSec: number | null
}

export interface BeszelContainerStatsRecord {
  timestamp: string | null
  containers: BeszelContainerStatsSample[]
}

/** The hub's own ns/nr→bytes fallback multiplies by 1024² (createContainerRecords). */
const MB_IN_BYTES = 1024 * 1024

function deprecatedMbPerSecToBytes(v: unknown): number | null {
  const n = optNumber(v)
  return n === null ? null : n * MB_IN_BYTES
}

/** Normalize one `container_stats` record: `stats` is an array of per-container entries. */
export function normalizeContainerStats(raw: RawRecord): BeszelContainerStatsRecord {
  if (!Array.isArray(raw.stats)) throw incompatible('container_stats', 'stats')
  const containers: BeszelContainerStatsSample[] = []
  for (const entry of raw.stats) {
    const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
    if (!e || typeof e.n !== 'string' || e.n === '') throw incompatible('container_stats', 'stats[].n')
    const bandwidth = Array.isArray(e.b) && e.b.length === 2 ? (e.b as number[]) : null
    containers.push({
      name: e.n,
      cpuPct: optNumber(e.c),
      memoryMb: optNumber(e.m),
      // `b` [sent, recv] bytes/s (agents ≥ 0.18.3); older records carry only ns/nr in MB/s
      netSentBytesPerSec: bandwidth ? (bandwidth[0] ?? 0) : deprecatedMbPerSecToBytes(e.ns),
      netRecvBytesPerSec: bandwidth ? (bandwidth[1] ?? 0) : deprecatedMbPerSecToBytes(e.nr),
    })
  }
  return { timestamp: pbDateToIso(raw.created), containers }
}

/** Bound on the raw attribute table — smartctl reports at most a few dozen rows. */
export const SMART_ATTRIBUTES_MAX = 64

export interface BeszelSmartAttribute {
  id: number | null
  name: string
  value: number | null
  worst: number | null
  threshold: number | null
  rawValue: number | null
  rawString: string | null
  whenFailed: string | null
}

export interface BeszelSmartDevice {
  id: string
  name: string
  model: string | null
  serial: string | null
  firmware: string | null
  /** smartctl verdict: PASSED / FAILED. */
  state: string | null
  /** Device protocol as reported: nvme / sat / scsi / … */
  type: string | null
  capacityBytes: number | null
  temperatureC: number | null
  powerOnHours: number | null
  powerCycles: number | null
  /** Raw SMART attribute table, bounded to SMART_ATTRIBUTES_MAX entries. */
  attributes: BeszelSmartAttribute[]
  updatedAt: string | null
}

export function normalizeSmartDevice(raw: RawRecord): BeszelSmartDevice {
  const id = requireString(raw, 'smart_devices', 'id')
  const name = requireString(raw, 'smart_devices', 'name')
  const rawAttrs = Array.isArray(raw.attributes) ? raw.attributes : []
  const attributes: BeszelSmartAttribute[] = []
  for (const entry of rawAttrs.slice(0, SMART_ATTRIBUTES_MAX)) {
    if (!entry || typeof entry !== 'object') continue
    const a = entry as Record<string, unknown>
    const attrName = optString(a.n)
    if (!attrName) continue // attribute rows are advisory — drop malformed entries, don't fail the device
    attributes.push({
      id: optNumber(a.id),
      name: attrName,
      value: optNumber(a.v),
      worst: optNumber(a.w),
      threshold: optNumber(a.t),
      rawValue: optNumber(a.rv),
      rawString: optString(a.rs),
      whenFailed: optString(a.wf),
    })
  }
  return {
    id,
    name,
    model: optString(raw.model),
    serial: optString(raw.serial),
    firmware: optString(raw.firmware),
    state: optString(raw.state),
    type: optString(raw.type),
    capacityBytes: optNumber(raw.capacity),
    temperatureC: optNumber(raw.temp),
    powerOnHours: optNumber(raw.hours),
    powerCycles: optNumber(raw.cycles),
    attributes,
    updatedAt: pbDateToIso(raw.updated),
  }
}

export interface BeszelContainer {
  id: string
  name: string
  systemId: string | null
  image: string | null
  status: string | null
  health: ContainerHealth | null
  cpuPct: number | null
  memoryMb: number | null
  netBytesPerSec: number | null
  ports: string | null
  updatedAt: string | null
}

export function normalizeContainer(raw: RawRecord): BeszelContainer {
  const id = requireString(raw, 'containers', 'id')
  const name = requireString(raw, 'containers', 'name')
  const health = optNumber(raw.health)
  return {
    id,
    name,
    systemId: optString(raw.system),
    image: optString(raw.image),
    status: optString(raw.status),
    health: health !== null ? (CONTAINER_HEALTHS[health] ?? null) : null,
    cpuPct: optNumber(raw.cpu),
    memoryMb: optNumber(raw.memory),
    netBytesPerSec: optNumber(raw.net),
    ports: optString(raw.ports),
    updatedAt: epochMsToIso(raw.updated),
  }
}

export interface BeszelAlert {
  id: string
  /** Alert type: Status, CPU, Memory, Disk, Temperature, Bandwidth, GPU, LoadAvg1/5/15, Battery. */
  type: string
  systemId: string
  systemName: string | null
  triggered: boolean
  /** Configured threshold (%, °C, MB/s, … depending on type). */
  threshold: number | null
  /** Minutes the threshold must hold before the alert fires. */
  minMinutes: number | null
  updatedAt: string | null
}

export function normalizeAlert(raw: RawRecord): BeszelAlert {
  const id = requireString(raw, 'alerts', 'id')
  const type = requireString(raw, 'alerts', 'name')
  const systemId = requireString(raw, 'alerts', 'system')
  const expand = raw.expand && typeof raw.expand === 'object' ? (raw.expand as Record<string, unknown>) : null
  const expandedSystem =
    expand?.system && typeof expand.system === 'object' ? (expand.system as Record<string, unknown>) : null
  return {
    id,
    type,
    systemId,
    systemName: expandedSystem ? optString(expandedSystem.name) : null,
    triggered: raw.triggered === true,
    threshold: optNumber(raw.value),
    minMinutes: optNumber(raw.min),
    updatedAt: pbDateToIso(raw.updated),
  }
}
