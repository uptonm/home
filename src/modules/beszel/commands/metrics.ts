import type { CommandSpec, RunContext, RunResult } from '../../../core/types'
import { createTransport, pbQuote, readBeszelConfig, type BeszelTransport, type RawRecord } from '../client'
import { normalizeContainerStats, normalizeSystemStatsPoint } from '../adapter'
import {
  DEFAULT_MAX_POINTS,
  MAX_POINTS_CAP,
  STATS_INTERVALS,
  intervalForWindow,
  parseSince,
  pbFilterDate,
  type StatsInterval,
} from '../history'
import { parseBoundedInt, requiredPositional, resolveSystemArg } from './shared'

const INTERVAL_DOC = 'auto-selected from the window when omitted: ≤2h→1m, ≤8h→10m, ≤24h→20m, ≤5d→120m, else 480m'
const SINCE_DOC = 'Window start: 30m | 6h | 2d | ISO 8601 timestamp (default 60m)'
const MAX_DOC = `Max points returned, most recent win (default ${DEFAULT_MAX_POINTS}, cap ${MAX_POINTS_CAP})`
/** Candidate names in a not-found message stay readable even on container-heavy hosts. */
const CANDIDATES_SHOWN = 20

interface ParsedWindow {
  sinceMs: number
  sinceIso: string
  max: number
}

function parseWindow(ctx: RunContext, nowMs: number): { ok: true; window: ParsedWindow } | { ok: false; error: RunResult } {
  const max = parseBoundedInt(ctx, 'max', DEFAULT_MAX_POINTS, MAX_POINTS_CAP)
  if (max.error) return { ok: false, error: { ok: false, kind: 'user', message: max.error, code: 'bad_arg' } }
  const since = parseSince(ctx.args.since === undefined ? undefined : String(ctx.args.since), nowMs)
  if (!since.ok) return { ok: false, error: { ok: false, kind: 'user', message: since.error, code: 'bad_arg' } }
  return {
    ok: true,
    window: { sinceMs: since.sinceMs, sinceIso: new Date(since.sinceMs).toISOString(), max: max.value },
  }
}

/**
 * Newest-first fetch of one extra record: overflow proves truncation, and the
 * slice keeps exactly the most recent `max` points. Returned oldest-first.
 */
async function fetchSeries(
  t: BeszelTransport,
  collection: 'system_stats' | 'container_stats',
  systemId: string,
  interval: StatsInterval,
  sinceMs: number,
  max: number,
): Promise<{ raw: RawRecord[]; truncated: boolean }> {
  const raw = await t.list(collection, max + 1, {
    filter: `system=${pbQuote(systemId)} && type="${interval}" && created>=${pbQuote(pbFilterDate(sinceMs))}`,
    sort: '-created',
  })
  return { raw: raw.slice(0, max).reverse(), truncated: raw.length > max }
}

export const metricsGetCmd: CommandSpec = {
  path: ['metrics', 'get'],
  effect: 'read',
  description: `Bounded system metric history (cpu, memory, disk, network, temps, load); interval ${INTERVAL_DOC}`,
  args: [
    { name: 'system', kind: 'positional', description: 'System id or exact name', required: true },
    { name: 'since', kind: 'string', description: SINCE_DOC },
    { name: 'interval', kind: 'string', description: `Sample tier; ${INTERVAL_DOC}`, enum: STATS_INTERVALS },
    { name: 'max', kind: 'number', description: MAX_DOC },
  ],
  examples: [
    'home beszel metrics get boris --json',
    'home beszel metrics get boris --since 6h --json',
    'home beszel metrics get boris --since 2d --interval 120m --max 200 --json',
  ],
  async run(ctx) {
    const nowMs = Date.now()
    const parsed = parseWindow(ctx, nowMs)
    if (!parsed.ok) return parsed.error
    const intervalArg = ctx.args.interval === undefined ? undefined : String(ctx.args.interval).trim()
    if (intervalArg && !(STATS_INTERVALS as readonly string[]).includes(intervalArg)) {
      return {
        ok: false,
        kind: 'user',
        message: `--interval must be one of ${STATS_INTERVALS.join(', ')}, got "${intervalArg}"`,
        code: 'bad_arg',
      }
    }
    const t = createTransport(readBeszelConfig(ctx.config))
    const picked = await resolveSystemArg(ctx, t)
    if (!picked.ok) return picked.error
    const interval = (intervalArg as StatsInterval | undefined) ?? intervalForWindow(nowMs - parsed.window.sinceMs)
    const { raw, truncated } = await fetchSeries(
      t,
      'system_stats',
      picked.system.id,
      interval,
      parsed.window.sinceMs,
      parsed.window.max,
    )
    return {
      ok: true,
      data: {
        system: picked.system,
        interval,
        since: parsed.window.sinceIso,
        truncated,
        points: raw.map(normalizeSystemStatsPoint),
      },
    }
  },
}

export const containerMetricsGetCmd: CommandSpec = {
  path: ['container-metrics', 'get'],
  effect: 'read',
  description: `Bounded per-container metric history (cpu %, memory MB, network bytes/s); interval ${INTERVAL_DOC}`,
  args: [
    { name: 'system', kind: 'positional', description: 'System id or exact name', required: true },
    { name: 'container', kind: 'positional', description: 'Container name as reported in container_stats', required: true },
    { name: 'since', kind: 'string', description: SINCE_DOC },
    { name: 'max', kind: 'number', description: MAX_DOC },
  ],
  examples: [
    'home beszel container-metrics get boris caddy --json',
    'home beszel container-metrics get boris caddy --since 6h --max 50 --json',
  ],
  async run(ctx) {
    const containerRef = requiredPositional(ctx, 'container')
    if (!containerRef) return { ok: false, kind: 'user', message: 'container name is required', code: 'missing_arg' }
    const nowMs = Date.now()
    const parsed = parseWindow(ctx, nowMs)
    if (!parsed.ok) return parsed.error
    const t = createTransport(readBeszelConfig(ctx.config))
    const picked = await resolveSystemArg(ctx, t)
    if (!picked.ok) return picked.error
    const interval = intervalForWindow(nowMs - parsed.window.sinceMs)
    const { raw, truncated } = await fetchSeries(
      t,
      'container_stats',
      picked.system.id,
      interval,
      parsed.window.sinceMs,
      parsed.window.max,
    )
    const records = raw.map(normalizeContainerStats)
    const base = { system: picked.system, interval, since: parsed.window.sinceIso }
    if (records.length === 0) {
      return {
        ok: true,
        data: {
          ...base,
          container: containerRef,
          truncated,
          points: [],
          note: `no container_stats samples for ${picked.system.name} in this window`,
        },
      }
    }

    // container_stats entries carry only names — resolve exact, then exact
    // case-insensitive, mirroring resolve.ts semantics without ids.
    const names = [...new Set(records.flatMap((r) => r.containers.map((c) => c.name)))].sort()
    let target = names.find((n) => n === containerRef)
    if (target === undefined) {
      const ql = containerRef.toLowerCase()
      const ciMatches = names.filter((n) => n.toLowerCase() === ql)
      if (ciMatches.length > 1) {
        return {
          ok: false,
          kind: 'user',
          message: `${ciMatches.length} containers match ${JSON.stringify(containerRef)}: ${ciMatches.join(', ')} — use the exact name`,
          code: 'ambiguous',
        }
      }
      if (ciMatches.length === 0) {
        const shown = names.slice(0, CANDIDATES_SHOWN).join(', ') + (names.length > CANDIDATES_SHOWN ? ', …' : '')
        return {
          ok: false,
          kind: 'user',
          message: `no container named ${JSON.stringify(containerRef)} on ${picked.system.name} in this window — saw: ${shown}`,
          code: 'not_found',
        }
      }
      target = ciMatches[0]!
    }

    const points = []
    for (const record of records) {
      const sample = record.containers.find((c) => c.name === target)
      // A record without the container is a sample where it wasn't running — skip, don't null-fill.
      if (sample === undefined) continue
      points.push({
        timestamp: record.timestamp,
        cpuPct: sample.cpuPct,
        memoryMb: sample.memoryMb,
        netSentBytesPerSec: sample.netSentBytesPerSec,
        netRecvBytesPerSec: sample.netRecvBytesPerSec,
      })
    }
    return { ok: true, data: { ...base, container: target, truncated, points } }
  },
}
