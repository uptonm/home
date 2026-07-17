/**
 * Bounded-history plumbing shared by `metrics get` and `container-metrics get`.
 * Both system_stats and container_stats carry the same `type` select
 * (1m/10m/20m/120m/480m per the v0.18.7 migration snapshot), so tier selection
 * and window parsing live here once.
 */

export const STATS_INTERVALS = ['1m', '10m', '20m', '120m', '480m'] as const
export type StatsInterval = (typeof STATS_INTERVALS)[number]

export const DEFAULT_SINCE_MS = 60 * 60_000
export const DEFAULT_MAX_POINTS = 120
export const MAX_POINTS_CAP = 500

const HOUR_MS = 3_600_000

/**
 * Pick the coarsest tier that still gives dense coverage of the window:
 * ≤2h→1m, ≤8h→10m, ≤24h→20m, ≤5d→120m, else 480m.
 */
export function intervalForWindow(windowMs: number): StatsInterval {
  if (windowMs <= 2 * HOUR_MS) return '1m'
  if (windowMs <= 8 * HOUR_MS) return '10m'
  if (windowMs <= 24 * HOUR_MS) return '20m'
  if (windowMs <= 120 * HOUR_MS) return '120m'
  return '480m'
}

export type ParsedSince = { ok: true; sinceMs: number } | { ok: false; error: string }

/** `--since`: a simple duration (30m, 6h, 2d), an ISO 8601 timestamp, or the 60m default. */
export function parseSince(raw: string | undefined, nowMs: number): ParsedSince {
  if (raw === undefined || raw.trim() === '') return { ok: true, sinceMs: nowMs - DEFAULT_SINCE_MS }
  const value = raw.trim()
  const m = /^(\d+)(s|m|h|d)$/.exec(value)
  if (m) {
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd']
    return { ok: true, sinceMs: nowMs - Number(m[1]) * unitMs }
  }
  const parsed = Date.parse(value)
  if (!Number.isNaN(parsed)) return { ok: true, sinceMs: parsed }
  return {
    ok: false,
    error: `--since must be a duration (30m, 6h, 2d) or an ISO 8601 timestamp, got "${raw}"`,
  }
}

/**
 * PocketBase stores autodates as `YYYY-MM-DD HH:MM:SS.sssZ` text, so a filter
 * literal in the same format compares correctly.
 */
export function pbFilterDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ')
}
