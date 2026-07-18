import type { RunResult } from '../../../core/types'
import type { DriveFile, ResolveFileResult } from '../client'

type RunError = Extract<RunResult, { ok: false }>

/** Compact "name (id)" list of candidate files for an ambiguous-match message. */
export function describeCandidates(matches: DriveFile[]): string {
  const shown = matches.slice(0, 10).map((f) => `${f.name ?? '?'} (${f.id ?? '?'})`)
  const extra = matches.length > shown.length ? `, …(+${matches.length - shown.length})` : ''
  return shown.join(', ') + extra
}

/**
 * Collapse a `ResolveFileResult` into either the resolved file or a ready-made
 * user-facing error result. Shared by `files get/download/export` so all three
 * report not-found / ambiguous identically.
 */
export function unwrapResolution(
  result: ResolveFileResult,
  ref: string,
): { ok: true; file: DriveFile } | { ok: false; error: RunError } {
  if (result.kind === 'not_found') {
    return {
      ok: false,
      error: { ok: false, kind: 'user', message: `no file matching ${JSON.stringify(ref)}`, code: 'not_found' },
    }
  }
  if (result.kind === 'ambiguous') {
    return {
      ok: false,
      error: {
        ok: false,
        kind: 'user',
        message: `${result.matches.length} files match ${JSON.stringify(ref)}: ${describeCandidates(result.matches)}`,
        code: 'ambiguous',
      },
    }
  }
  return { ok: true, file: result.file }
}

/** Sanitize a Drive filename for safe use as a local output path component. */
export function safeFilename(name: string, fallback: string): string {
  const cleaned = name.replace(/[/\\\0]/g, '_').trim()
  return cleaned.length > 0 ? cleaned : fallback
}
