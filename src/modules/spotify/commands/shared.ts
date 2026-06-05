import type { RunResult } from '../../../core/types'
import { extractSpotifyRef } from '../client'

/** The error arm of `RunResult` — what a command returns on bad input. */
export type RunError = Extract<RunResult, { ok: false }>

function userError(message: string, code: string): RunError {
  return { ok: false, kind: 'user', message, code }
}

export const DEFAULT_MARKET = 'US'
export const DEFAULT_LIMIT = 20
// Spotify's paging endpoints cap a single page at 50 items; asking for more is
// silently clamped upstream, so we reject it here to keep `total`/`offset`
// paging math honest.
export const MAX_LIMIT = 50

/**
 * Resolve a `<ref>` positional (bare id / `spotify:` URI / share URL) to a bare
 * Spotify id. Returns `{ id }` on success or `{ error }` the command returns
 * as-is — distinguishing "you forgot the argument" from "that isn't a Spotify
 * reference".
 */
export function resolveRef(raw: unknown, label = 'ref'): { id: string } | { error: RunError } {
  const s = String(raw ?? '').trim()
  if (!s) return { error: userError(`${label} is required`, 'missing_arg') }
  const id = extractSpotifyRef(s)
  if (!id) {
    return {
      error: userError(
        `not a valid Spotify ${label}: ${s} — pass a 22-char id, spotify:<type>:<id> URI, or open.spotify.com URL`,
        'bad_ref',
      ),
    }
  }
  return { id }
}

export function parseMarket(raw: unknown): { market: string } | { error: RunError } {
  const market = raw !== undefined ? String(raw).toUpperCase() : DEFAULT_MARKET
  if (!/^[A-Z]{2}$/.test(market)) {
    return { error: userError('market must be a 2-letter ISO 3166-1 country code', 'bad_arg') }
  }
  return { market }
}

export function parseLimit(raw: unknown): { limit: number } | { error: RunError } {
  if (raw === undefined) return { limit: DEFAULT_LIMIT }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) {
    return { error: userError('limit must be a positive number', 'bad_arg') }
  }
  return { limit: Math.min(Math.floor(n), MAX_LIMIT) }
}

export function parseOffset(raw: unknown): { offset: number } | { error: RunError } {
  if (raw === undefined) return { offset: 0 }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    return { error: userError('offset must be a non-negative number', 'bad_arg') }
  }
  return { offset: Math.floor(n) }
}
