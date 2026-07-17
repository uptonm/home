/**
 * Normalizers for the Uptime Kuma 1.23.x public status-page API. Raw route
 * payloads never leave this module — commands return only the shapes here.
 *
 * Field inventory pinned against the 1.23.X branch (github.com/louislam/uptime-kuma):
 *  - GET /api/status-page/:slug → {config, incident, publicGroupList, maintenanceList}:
 *    server/routers/status-page-router.js + server/model/status_page.js `getStatusPageData`
 *  - config keys (slug/title/description/icon/theme/published/showTags/…/showCertificateExpiry):
 *    server/model/status_page.js `toPublicJSON`
 *  - group {id, name, weight, monitorList}: server/model/group.js `toPublicJSON`
 *  - monitor {id, name, sendUrl, type, url?, certExpiryDaysRemaining?, validCert?}:
 *    server/model/monitor.js `toPublicJSON` — cert fields appear only when the page
 *    sets showCertificateExpiry AND the monitor is http/keyword/json-query over
 *    https; `getCertExpiry` returns {"", false} when no valid cert info is stored
 *  - incident {id, style, title, content, pin, createdDate, lastUpdatedDate}:
 *    server/model/incident.js `toPublicJSON`; dates written as UTC
 *    "YYYY-MM-DD HH:mm:ss" (R.isoDateTime(dayjs.utc()) — status-page-socket-handler.js)
 *  - maintenance {id, title, description, strategy, active, timeslotList, timezone,
 *    timezoneOffset, durationMinutes, status, …}: server/model/maintenance.js
 *    `toPublicJSON`; cron/recurring timeslots are real ISO strings
 *    (dayjs.toISOString), "single" timeslots are the raw local
 *    "YYYY-MM-DD HH:mm[:ss]" start/end dates in the window's own timezone
 *  - heartbeat {status, time, msg:"", ping}: server/model/heartbeat.js `toPublicJSON`;
 *    status ints 0 DOWN / 1 UP / 2 PENDING / 3 MAINTENANCE (same file); time
 *    written as UTC "YYYY-MM-DD HH:mm:ss.SSS" (R.isoDateTimeMillis(dayjs.utc()) —
 *    monitor.js `beat`)
 *  - uptimeList values are 0..1 ratios over 24h: monitor.js `calcUptime`
 */
import { SystemError } from '../../core/errors'
import type { RawHeartbeat, RawStatusPage } from './client'

export const MONITOR_STATUSES = ['up', 'down', 'pending', 'maintenance'] as const
export type MonitorStatus = (typeof MONITOR_STATUSES)[number]

/** Heartbeat status ints per server/model/heartbeat.js: 0 DOWN, 1 UP, 2 PENDING, 3 MAINTENANCE. */
const STATUS_BY_INT: Record<number, MonitorStatus> = { 0: 'down', 1: 'up', 2: 'pending', 3: 'maintenance' }

export function heartbeatStatusToString(v: unknown): MonitorStatus | null {
  return typeof v === 'number' ? (STATUS_BY_INT[v] ?? null) : null
}

function apiDrift(where: string): SystemError {
  return new SystemError(
    `uptime-kuma: unexpected shape in ${where} — the instance's API does not match this adapter (targets 1.23.x)`,
    'kuma_api_failed',
  )
}

function optString(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function optNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Kuma writes heartbeat/incident times as UTC "YYYY-MM-DD HH:mm:ss(.SSS)"; emit ISO 8601. */
export function kumaUtcToIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const withT = v.includes('T') ? v : v.replace(' ', 'T')
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(withT) ? withT : `${withT}Z`
  const d = new Date(zoned)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Maintenance "single" timeslots are local "YYYY-MM-DD HH:mm[:ss]" strings in
 * the window's own timezone; the payload's `timezoneOffset` ("+02:00") anchors
 * them. Cron/recurring timeslots arrive as real ISO strings and pass through.
 */
export function kumaLocalToIso(v: unknown, timezoneOffset: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  if (/(Z|[+-]\d{2}:\d{2})$/.test(v)) return kumaUtcToIso(v)
  const offset = typeof timezoneOffset === 'string' && /^[+-]\d{2}:\d{2}$/.test(timezoneOffset) ? timezoneOffset : 'Z'
  const d = new Date(`${v.replace(' ', 'T')}${offset}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** calcUptime ratio (0..1) → percentage with two decimals. */
export function uptimeRatioToPct(v: unknown): number | null {
  const n = optNumber(v)
  return n === null ? null : Math.round(n * 10000) / 100
}

export interface KumaPageMonitor {
  /** Kuma monitor ids are numbers; stringified so id/name resolution has one key type. */
  id: string
  name: string
  group: string
  type: string | null
  url: string | null
  /** Days until the TLS cert expires — only for https monitors on a page with showCertificateExpiry. */
  certExpiryDays: number | null
  validCert: boolean | null
}

export interface KumaGroup {
  id: number | null
  name: string
  monitors: KumaPageMonitor[]
}

export interface KumaIncident {
  id: number | null
  style: string | null
  title: string | null
  content: string | null
  createdAt: string | null
  lastUpdatedAt: string | null
}

export interface KumaMaintenance {
  id: number | null
  title: string | null
  description: string | null
  strategy: string | null
  /** inactive / scheduled / under-maintenance / ended / unknown (maintenance.js getStatus). */
  status: string | null
  timezone: string | null
  timezoneOffset: string | null
  durationMinutes: number | null
  timeslots: { startsAt: string | null; endsAt: string | null }[]
}

export interface KumaPage {
  slug: string | null
  title: string
  description: string | null
  published: boolean
  showCertificateExpiry: boolean
  groups: KumaGroup[]
  incident: KumaIncident | null
  maintenances: KumaMaintenance[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function normalizeMonitor(raw: unknown, group: string): KumaPageMonitor {
  const m = asRecord(raw)
  const id = m ? optNumber(m.id) : null
  const name = m ? optString(m.name) : null
  if (!m || id === null || name === null) throw apiDrift('publicGroupList[].monitorList[]')
  // getCertExpiry returns certExpiryDaysRemaining: "" when no valid cert is stored.
  return {
    id: String(id),
    name,
    group,
    type: optString(m.type),
    url: optString(m.url),
    certExpiryDays: optNumber(m.certExpiryDaysRemaining),
    validCert: typeof m.validCert === 'boolean' ? m.validCert : null,
  }
}

function normalizeIncident(raw: unknown): KumaIncident | null {
  const i = asRecord(raw)
  if (!i) return null
  return {
    id: optNumber(i.id),
    style: optString(i.style),
    title: optString(i.title),
    content: optString(i.content),
    createdAt: kumaUtcToIso(i.createdDate),
    lastUpdatedAt: kumaUtcToIso(i.lastUpdatedDate),
  }
}

function normalizeMaintenance(raw: unknown): KumaMaintenance {
  const m = asRecord(raw)
  if (!m) throw apiDrift('maintenanceList[]')
  const offset = m.timezoneOffset
  const timeslots: KumaMaintenance['timeslots'] = []
  for (const slotRaw of Array.isArray(m.timeslotList) ? m.timeslotList : []) {
    const slot = asRecord(slotRaw)
    if (!slot) continue
    timeslots.push({
      startsAt: kumaLocalToIso(slot.startDate, offset),
      endsAt: kumaLocalToIso(slot.endDate, offset),
    })
  }
  return {
    id: optNumber(m.id),
    title: optString(m.title),
    description: optString(m.description),
    strategy: optString(m.strategy),
    status: optString(m.status),
    timezone: optString(m.timezone),
    timezoneOffset: optString(offset),
    durationMinutes: optNumber(m.durationMinutes),
    timeslots,
  }
}

export function normalizeStatusPage(raw: RawStatusPage): KumaPage {
  const config = asRecord(raw.config)
  const title = config ? optString(config.title) : null
  if (!config || title === null) throw apiDrift('config')

  const groups: KumaGroup[] = []
  for (const groupRaw of Array.isArray(raw.publicGroupList) ? raw.publicGroupList : []) {
    const g = asRecord(groupRaw)
    const name = g ? optString(g.name) : null
    if (!g || name === null) throw apiDrift('publicGroupList[]')
    const monitorList = Array.isArray(g.monitorList) ? g.monitorList : []
    groups.push({ id: optNumber(g.id), name, monitors: monitorList.map((m) => normalizeMonitor(m, name)) })
  }

  return {
    slug: optString(config.slug),
    title,
    description: optString(config.description),
    published: config.published === true,
    showCertificateExpiry: config.showCertificateExpiry === true,
    groups,
    incident: normalizeIncident(raw.incident),
    maintenances: (Array.isArray(raw.maintenanceList) ? raw.maintenanceList : []).map(normalizeMaintenance),
  }
}

/** The heartbeat route caps each monitor at the 50 newest beats (LIMIT 50, ascending). */
export const BEATS_MAX = 50

export interface KumaBeat {
  status: MonitorStatus | null
  at: string | null
  latencyMs: number | null
}

/** Normalize one monitor's beat list; keeps the newest BEATS_MAX, oldest→newest. */
export function normalizeBeats(raw: RawHeartbeat[]): KumaBeat[] {
  return raw.slice(-BEATS_MAX).map((b) => ({
    status: heartbeatStatusToString(b?.status),
    at: kumaUtcToIso(b?.time),
    latencyMs: optNumber(b?.ping),
  }))
}

export interface KumaLatencySummary {
  samples: number
  avgMs: number | null
  minMs: number | null
  maxMs: number | null
}

/** avg/min/max over the beats that carry a ping — bounded by BEATS_MAX upstream. */
export function summarizeLatency(beats: KumaBeat[]): KumaLatencySummary {
  const pings = beats.map((b) => b.latencyMs).filter((p): p is number => p !== null)
  if (pings.length === 0) return { samples: 0, avgMs: null, minMs: null, maxMs: null }
  const sum = pings.reduce((acc, p) => acc + p, 0)
  return {
    samples: pings.length,
    avgMs: Math.round((sum / pings.length) * 10) / 10,
    minMs: Math.min(...pings),
    maxMs: Math.max(...pings),
  }
}
