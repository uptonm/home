import type { RunContext } from '../../../core/types'

export const DEFAULT_EVENTS_MAX = 25
// The Calendar API caps events.list at 2500 results per page.
export const EVENTS_MAX_CAP = 2500

export const DEFAULT_CALENDARS_MAX = 100
// calendarList.list caps at 250 results per page.
export const CALENDARS_MAX_CAP = 250

export interface ParseResult<T> {
  value?: T
  error?: string
  warning?: string
}

/** Parse `--max <n>` into a bounded page size, defaulting when absent. */
export function parseMax(ctx: RunContext, fallback: number, cap: number): ParseResult<number> {
  if (ctx.args.max === undefined) return { value: fallback }
  const n = Number(ctx.args.max)
  if (!Number.isFinite(n) || n < 1) {
    return { error: 'max must be a positive number' }
  }
  const clamped = Math.min(Math.floor(n), cap)
  if (clamped < n) {
    return { value: clamped, warning: `max capped at ${cap} (Calendar API limit)` }
  }
  return { value: clamped }
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse `--from`/`--to` into the RFC 3339 timestamp `timeMin`/`timeMax`
 * require. RFC 3339 input passes through verbatim; a bare `YYYY-MM-DD`
 * expands to local midnight of that day.
 */
export function parseTimeBound(ctx: RunContext, name: string): ParseResult<string | undefined> {
  if (ctx.args[name] === undefined) return { value: undefined }
  const s = String(ctx.args[name]).trim()
  if (!s) return { value: undefined }
  if (BARE_DATE.test(s)) {
    const [year, month, day] = s.split('-').map(Number)
    return { value: new Date(year!, month! - 1, day!).toISOString() }
  }
  if (Number.isNaN(Date.parse(s))) {
    return { error: `invalid --${name}: "${s}" — use RFC 3339 (2026-07-17T09:00:00Z) or YYYY-MM-DD` }
  }
  return { value: s }
}

/** Optional string arg, trimmed; undefined when absent or empty. */
export function optionalString(ctx: RunContext, name: string): string | undefined {
  if (ctx.args[name] === undefined) return undefined
  const s = String(ctx.args[name]).trim()
  return s.length > 0 ? s : undefined
}
