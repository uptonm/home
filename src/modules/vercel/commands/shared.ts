import type { RunContext } from '../../../core/types'

export interface ParsedLimit {
  value: number
  error?: string
}

/** Bounded `--limit`: default when omitted, error when nonsense, capped at `max`. */
export function parseLimit(ctx: RunContext, fallback: number, max: number): ParsedLimit {
  const raw = ctx.args.limit
  if (raw === undefined) return { value: fallback }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return { value: fallback, error: `--limit must be a positive integer, got "${raw}"` }
  return { value: Math.min(n, max) }
}

export function requiredPositional(ctx: RunContext, name: string): string {
  return String(ctx.args[name] ?? '').trim()
}

export function optionalFlag(ctx: RunContext, name: string): string | undefined {
  const raw = ctx.args[name]
  if (raw === undefined) return undefined
  const s = String(raw).trim()
  return s === '' ? undefined : s
}
