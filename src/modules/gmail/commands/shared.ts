import type { RunContext } from '../../../core/types'

export const DEFAULT_MAX_RESULTS = 25
// Gmail caps list endpoints at 500 results per page.
export const MAX_MAX_RESULTS = 500

export interface ParseResult<T> {
  value?: T
  error?: string
}

/** Parse `--max <n>` into a 1..500 page size, defaulting when absent. */
export function parseMax(ctx: RunContext): ParseResult<number> {
  if (ctx.args.max === undefined) return { value: DEFAULT_MAX_RESULTS }
  const n = Number(ctx.args.max)
  if (!Number.isFinite(n) || n < 1) {
    return { error: 'max must be a positive number' }
  }
  return { value: Math.min(Math.floor(n), MAX_MAX_RESULTS) }
}

/** Parse `--label a,b,c` into a label-id array (undefined when absent). */
export function parseLabels(ctx: RunContext): string[] | undefined {
  if (ctx.args.label === undefined) return undefined
  const ids = String(ctx.args.label)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return ids.length > 0 ? ids : undefined
}

/** Optional string arg, trimmed; undefined when absent or empty. */
export function optionalString(ctx: RunContext, name: string): string | undefined {
  if (ctx.args[name] === undefined) return undefined
  const s = String(ctx.args[name]).trim()
  return s.length > 0 ? s : undefined
}

/** Validate an optional `--format` against an allow-list. */
export function parseFormat<T extends string>(
  ctx: RunContext,
  allowed: readonly T[],
): ParseResult<T | undefined> {
  if (ctx.args.format === undefined) return { value: undefined }
  const f = String(ctx.args.format).toLowerCase()
  if (!(allowed as readonly string[]).includes(f)) {
    return { error: `invalid --format: ${f} — allowed: ${allowed.join(', ')}` }
  }
  return { value: f as T }
}
