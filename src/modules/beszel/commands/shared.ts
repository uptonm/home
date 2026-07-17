import type { RunContext, RunResult } from '../../../core/types'
import type { BeszelTransport } from '../client'
import { normalizeSystem, type BeszelSystem } from '../adapter'
import { resolveExact } from '../resolve'

/** Bound on the systems fetch — a homelab hub with more than this is not our problem yet. */
export const SYSTEMS_LIMIT = 500

export async function fetchSystems(t: BeszelTransport, filter?: string): Promise<BeszelSystem[]> {
  const raw = await t.list('systems', SYSTEMS_LIMIT, { filter, sort: 'name' })
  return raw.map(normalizeSystem)
}

export function pickSystem(
  systems: BeszelSystem[],
  ref: string,
): { ok: true; system: BeszelSystem } | { ok: false; error: RunResult } {
  const result = resolveExact(systems, ref)
  if (result.kind === 'not_found') {
    return {
      ok: false,
      error: {
        ok: false,
        kind: 'user',
        message: `no system matching ${JSON.stringify(ref)} (exact id or exact name)`,
        code: 'not_found',
      },
    }
  }
  if (result.kind === 'ambiguous') {
    const candidates = result.matches.map((m) => `${m.name} (${m.id})`).join(', ')
    return {
      ok: false,
      error: {
        ok: false,
        kind: 'user',
        message: `${result.matches.length} systems match ${JSON.stringify(ref)}: ${candidates} — use the id`,
        code: 'ambiguous',
      },
    }
  }
  return { ok: true, system: result.item }
}

export interface SystemCounts {
  total: number
  up: number
  down: number
  paused: number
  pending: number
}

export function summarizeSystems(systems: BeszelSystem[]): SystemCounts {
  const counts: SystemCounts = { total: systems.length, up: 0, down: 0, paused: 0, pending: 0 }
  for (const s of systems) counts[s.status] += 1
  return counts
}

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
