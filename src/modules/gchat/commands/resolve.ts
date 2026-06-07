import type { RunResult } from '../../../core/types'
import { resolveSpace, type GchatConfig, type ResolvedSpace } from '../client'

/**
 * Resolve a positional space reference (resource name or display name) into a
 * single space, mapping not-found / ambiguous outcomes into user-facing
 * RunResults. Mirrors the assistant module's `resolveOrError`.
 */
export async function resolveSpaceOrError(
  cfg: GchatConfig,
  ref: string,
): Promise<{ ok: true; space: ResolvedSpace } | { ok: false; result: RunResult }> {
  const res = await resolveSpace(cfg, ref)
  if (res.kind === 'ok') return { ok: true, space: res.space }
  if (res.kind === 'not_found') {
    return {
      ok: false,
      result: {
        ok: false,
        kind: 'user',
        message: `no space matching "${ref}" — pass a resource name (spaces/AAAA) or a display-name substring`,
        code: 'not_found',
      },
    }
  }
  const list = res.matches
    .map((m) => `  ${m.name}${m.displayName ? ` (${m.displayName})` : ''}`)
    .join('\n')
  return {
    ok: false,
    result: {
      ok: false,
      kind: 'user',
      message: `"${ref}" is ambiguous — ${res.matches.length} spaces match:\n${list}\nPass an exact resource name.`,
      code: 'ambiguous',
    },
  }
}
