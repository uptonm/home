import type { RunContext, RunResult } from '../../../core/types'
import { UserError } from '../../../core/errors'
import { resolveExact } from '../../beszel/resolve'
import {
  MONITOR_STATUSES,
  normalizeBeats,
  normalizeStatusPage,
  summarizeLatency,
  uptimeRatioToPct,
  type KumaBeat,
  type KumaPage,
  type KumaPageMonitor,
  type MonitorStatus,
} from '../adapter'
import {
  createKumaTransport,
  readKumaConfig,
  type KumaConfig,
  type KumaTransport,
  type RawHeartbeatPayload,
} from '../client'

export function openTransport(ctx: RunContext): { cfg: KumaConfig; t: KumaTransport } {
  const cfg = readKumaConfig(ctx.config)
  return { cfg, t: createKumaTransport(cfg) }
}

/**
 * UserErrors thrown below the command layer (bad slug, unsupported mode,
 * partial config) are the caller's problem, not the system's — surface them as
 * `kind: 'user'` instead of letting the citty wrapper file them under system.
 */
export async function runKumaCommand(fn: () => Promise<RunResult>): Promise<RunResult> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof UserError) return { ok: false, kind: 'user', message: err.message, code: err.code }
    throw err
  }
}

/**
 * Staleness marker attached to every result: public status data is served
 * from Kuma's server-side cache and can trail reality by ~5 minutes.
 * `newestBeatAt` is the newest heartbeat timestamp this command saw (null when
 * it fetched no heartbeats).
 */
export interface KumaFreshness {
  cachedTransport: boolean
  newestBeatAt: string | null
}

export function freshnessFrom(t: KumaTransport, beatLists: KumaBeat[][]): KumaFreshness {
  let newest: string | null = null
  for (const beats of beatLists) {
    for (const beat of beats) {
      if (beat.at !== null && (newest === null || beat.at > newest)) newest = beat.at
    }
  }
  return { cachedTransport: t.cachedTransport, newestBeatAt: newest }
}

export function normalizeBeatMap(payload: RawHeartbeatPayload): Map<string, KumaBeat[]> {
  const out = new Map<string, KumaBeat[]>()
  for (const [monitorId, beats] of Object.entries(payload.heartbeatList ?? {})) {
    out.set(monitorId, normalizeBeats(Array.isArray(beats) ? beats : []))
  }
  return out
}

/** 24h uptime percentage for one monitor (uptimeList key `<id>_24`). */
export function uptime24hPctFor(payload: RawHeartbeatPayload, monitorId: string): number | null {
  return uptimeRatioToPct(payload.uptimeList?.[`${monitorId}_24`])
}

export interface MonitorBoardEntry extends KumaPageMonitor {
  status: MonitorStatus | null
  latencyMs: number | null
  lastBeatAt: string | null
  uptime24hPct: number | null
}

export interface MonitorBoard {
  page: KumaPage
  monitors: MonitorBoardEntry[]
  beatsByMonitor: Map<string, KumaBeat[]>
  freshness: KumaFreshness
}

/** Join the page's monitor inventory with the latest public beat per monitor. */
export async function fetchBoard(t: KumaTransport, slug: string): Promise<MonitorBoard> {
  const page = normalizeStatusPage(await t.getStatusPage(slug))
  const payload = await t.getHeartbeats(slug)
  const beatsByMonitor = normalizeBeatMap(payload)

  const monitors: MonitorBoardEntry[] = []
  for (const group of page.groups) {
    for (const monitor of group.monitors) {
      const beats = beatsByMonitor.get(monitor.id) ?? []
      const latest = beats[beats.length - 1]
      monitors.push({
        ...monitor,
        status: latest?.status ?? null,
        latencyMs: latest?.latencyMs ?? null,
        lastBeatAt: latest?.at ?? null,
        uptime24hPct: uptime24hPctFor(payload, monitor.id),
      })
    }
  }

  return { page, monitors, beatsByMonitor, freshness: freshnessFrom(t, [...beatsByMonitor.values()]) }
}

export function pickMonitor(
  monitors: MonitorBoardEntry[],
  ref: string,
): { ok: true; monitor: MonitorBoardEntry } | { ok: false; error: RunResult } {
  const result = resolveExact(monitors, ref)
  if (result.kind === 'not_found') {
    return {
      ok: false,
      error: {
        ok: false,
        kind: 'user',
        message: `no monitor matching ${JSON.stringify(ref)} on the status page (exact id or exact name)`,
        code: 'not_found',
      },
    }
  }
  if (result.kind === 'ambiguous') {
    const candidates = result.matches.map((m) => `${m.name} (id ${m.id}, group ${m.group})`).join(', ')
    return {
      ok: false,
      error: {
        ok: false,
        kind: 'user',
        message: `${result.matches.length} monitors match ${JSON.stringify(ref)}: ${candidates} — use the id`,
        code: 'ambiguous',
      },
    }
  }
  return { ok: true, monitor: result.item }
}

export interface MonitorCounts {
  total: number
  up: number
  down: number
  pending: number
  maintenance: number
  /** Monitors on the page whose beat list is empty (no public heartbeat yet). */
  unknown: number
}

/** down beats up: the summary's "worst" is the leftmost state present. */
const WORST_ORDER: readonly MonitorStatus[] = ['down', 'pending', 'maintenance', 'up']

export interface HeartbeatSummary {
  monitors: MonitorCounts
  worst: MonitorStatus | null
  /** Mean latency across each monitor's latest beat. */
  avgLatencyMs: number | null
  freshness: KumaFreshness
}

/** Counts by latest-beat state — needs only the heartbeat route, no page config. */
export function summarizeHeartbeats(t: KumaTransport, payload: RawHeartbeatPayload): HeartbeatSummary {
  const beatsByMonitor = normalizeBeatMap(payload)
  const counts: MonitorCounts = { total: 0, up: 0, down: 0, pending: 0, maintenance: 0, unknown: 0 }
  const latestBeats: KumaBeat[] = []
  for (const beats of beatsByMonitor.values()) {
    counts.total += 1
    const latest = beats[beats.length - 1]
    if (latest?.status) {
      counts[latest.status] += 1
      latestBeats.push(latest)
    } else {
      counts.unknown += 1
    }
  }
  const worst = WORST_ORDER.find((s) => counts[s] > 0) ?? null
  return {
    monitors: counts,
    worst,
    avgLatencyMs: summarizeLatency(latestBeats).avgMs,
    freshness: freshnessFrom(t, [...beatsByMonitor.values()]),
  }
}

export function parseStatusFilter(ctx: RunContext): { ok: true; status?: MonitorStatus } | { ok: false; error: RunResult } {
  if (ctx.args.status === undefined) return { ok: true }
  const status = String(ctx.args.status).trim()
  if (!(MONITOR_STATUSES as readonly string[]).includes(status)) {
    return {
      ok: false,
      error: {
        ok: false,
        kind: 'user',
        message: `--status must be one of ${MONITOR_STATUSES.join(', ')}, got "${status}"`,
        code: 'bad_arg',
      },
    }
  }
  return { ok: true, status: status as MonitorStatus }
}
