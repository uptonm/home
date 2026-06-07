import type { RunResult } from '../../../core/types'
import { resolve } from '../resolve'
import type { ProtectDevice } from '../client'

/**
 * Resolve a single entity by id/name from a bootstrap collection, translating
 * the `not_found`/`ambiguous` cases into ready-to-return `RunResult` errors so
 * every `get`/control command handles them identically.
 */
export function pickOne<T extends ProtectDevice>(
  coll: T[],
  ref: string,
  entity: string,
): { ok: true; item: T } | { ok: false; error: RunResult } {
  const result = resolve(coll, ref)
  if (result.kind === 'not_found') {
    return { ok: false, error: { ok: false, kind: 'user', message: `no ${entity} matching ${JSON.stringify(ref)}`, code: 'not_found' } }
  }
  if (result.kind === 'ambiguous') {
    const names = result.matches.map((m) => m.name ?? m.id ?? '?').join(', ')
    return {
      ok: false,
      error: {
        ok: false,
        kind: 'user',
        message: `${result.matches.length} ${entity}s match ${JSON.stringify(ref)}: ${names}`,
        code: 'ambiguous',
      },
    }
  }
  return { ok: true, item: result.item }
}
